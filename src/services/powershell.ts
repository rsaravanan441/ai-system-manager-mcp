/**
 * src/services/powershell.ts
 *
 * Secure PowerShell execution service.
 *
 * Responsibilities:
 * - Run PowerShell commands/scripts with timeout and structured output.
 * - Enforce an allowlist (by command pattern or by script path inside approved directories).
 * - Log executions (start/finish/output/error) to the DatabaseService.
 * - Prevent arbitrary destructive commands by refusing unapproved inputs.
 *
 * Usage:
 *  import powershell from "../services/powershell";
 *  const r = await powershell.runPowerShell("Get-ChildItem -Path C:\\Users", { timeoutMs: 30_000 });
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";
import db from "./database"; // DatabaseService singleton
import type { ExecutionLog } from "./database";

export type PowerShellResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  durationMs?: number;
  parsed?: any; // if stdout contained JSON and parsed successfully
};

export type ExecOptions = {
  timeoutMs?: number; // default: 30000
  allowlistPatterns?: string[]; // additional patterns (regex strings)
  allowScriptDirs?: string[]; // additional allowed directories for .ps1 files
  logToDb?: boolean; // default true
  dryRun?: boolean; // do not execute, but validate and return what would run
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ALLOWLIST_PATTERNS = [
  // simple allowlist of safe command prefixes - adjust as needed
  "^Get-(ChildItem|Item|Content|Command|Process|Service|EventLog|Module|Help|Host|ChildItem)$",
  "^Test-Path",
  "^Select-String",
  "^Where-Object",
  "^Sort-Object",
  "^Measure-Object",
  "^dotnet", // allow dotnet invocations (scanDotnet will still handle parsing)
  "^wsl",
  "^docker",
];
const DEFAULT_ALLOW_SCRIPT_DIRS = [
  // scripts must be inside the project or user's scripts dir to run
  path.resolve(process.cwd()),
  path.resolve(os.homedir(), "scripts"),
];

function isPathToPs1(input: string): boolean {
  // heuristics: contains .ps1 extension or is an absolute/relative path that ends with .ps1
  try {
    const maybe = input.split(" ")[0];
    return /\.ps1$/i.test(maybe) || fs.existsSync(path.resolve(maybe)) && maybe.toLowerCase().endsWith(".ps1");
  } catch {
    return false;
  }
}

function isAllowedScriptPath(scriptPath: string, allowedDirs: string[]): boolean {
  const resolved = path.resolve(scriptPath);
  for (const dir of allowedDirs) {
    const resolvedDir = path.resolve(dir);
    if (resolved.startsWith(resolvedDir + path.sep) || resolved === resolvedDir) {
      return true;
    }
  }
  return false;
}

function commandPrefix(cmd: string): string {
  // return the leading token (command) in the input
  const token = cmd.trim().split(/\s+/)[0] || "";
  return token;
}

function matchesAllowlist(cmd: string, patterns: string[]): boolean {
  const prefix = commandPrefix(cmd);
  for (const p of patterns) {
    try {
      const re = new RegExp(p, "i");
      if (re.test(prefix)) return true;
    } catch {
      // ignore invalid regex
    }
  }
  return false;
}

async function recordExecutionLogPartial(note: {
  recommendation_id?: number | null;
  action: string;
  command?: string | null;
  started_at?: string | null;
}): Promise<number> {
  try {
    const id = db.createExecutionLog({
      recommendation_id: note.recommendation_id ?? null,
      action: note.action,
      command: note.command ?? null,
      started_at: note.started_at ?? null,
      finished_at: null,
      success: 0,
      output: null,
      error: null,
      rollback_metadata: null,
    });
    return id;
  } catch {
    return -1;
  }
}

async function updateExecutionLog(id: number, update: Partial<ExecutionLog>) {
  try {
    // since DatabaseService doesn't include an update helper for logs, use SQL directly
    // Keep typed and safe: build small update statement
    const fields: string[] = [];
    const params: any = { id };
    if (update.finished_at !== undefined) { fields.push("finished_at = @finished_at"); params.finished_at = update.finished_at; }
    if (update.success !== undefined) { fields.push("success = @success"); params.success = update.success; }
    if (update.output !== undefined) { fields.push("output = @output"); params.output = update.output; }
    if (update.error !== undefined) { fields.push("error = @error"); params.error = update.error; }
    if (update.rollback_metadata !== undefined) { fields.push("rollback_metadata = @rollback_metadata"); params.rollback_metadata = update.rollback_metadata; }
    if (fields.length === 0) return;
    const sql = `UPDATE execution_logs SET ${fields.join(", ")} WHERE id = @id`;
    (db as any).db.prepare(sql).run(params); // use the internal db for small update
  } catch {
    // swallow errors; logging best-effort
  }
}

/**
 * runPowerShell
 * - Validates the requested command/script against allowlists.
 * - Optionally performs a dry-run (validation only).
 * - Executes PowerShell with a timeout and captures stdout/stderr.
 * - Logs the attempt to the database (start & finish).
 */
export default async function runPowerShell(
  input: string,
  args: string[] = [],
  options: ExecOptions = {}
): Promise<PowerShellResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowlistPatterns = [...DEFAULT_ALLOWLIST_PATTERNS, ...(options.allowlistPatterns ?? [])];
  const allowScriptDirs = [...DEFAULT_ALLOW_SCRIPT_DIRS, ...(options.allowScriptDirs ?? [])];
  const logToDb = options.logToDb ?? true;
  const dryRun = options.dryRun ?? false;

  const startAt = new Date();
  const action = isPathToPs1(input) ? `powershell:script` : `powershell:command`;
  const execLogId = logToDb
    ? await recordExecutionLogPartial({ action, command: [input, ...args].join(" "), started_at: startAt.toISOString() })
    : -1;

  // Validate input
  if (isPathToPs1(input)) {
    const scriptPath = input.split(" ")[0];
    if (!isAllowedScriptPath(scriptPath, allowScriptDirs)) {
      const errMsg = `Script path not allowed: ${scriptPath}`;
      if (execLogId > 0) await updateExecutionLog(execLogId, { finished_at: new Date().toISOString(), success: 0, error: errMsg });
      throw new Error(errMsg);
    }
  } else {
    if (!matchesAllowlist(input, allowlistPatterns)) {
      const errMsg = `Command not allowed by allowlist: ${commandPrefix(input)}`;
      if (execLogId > 0) await updateExecutionLog(execLogId, { finished_at: new Date().toISOString(), success: 0, error: errMsg });
      throw new Error(errMsg);
    }
  }

  if (dryRun) {
    const dur = Date.now() - startAt.getTime();
    if (execLogId > 0) await updateExecutionLog(execLogId, { finished_at: new Date().toISOString(), success: 0, output: `DRY RUN: ${[input, ...args].join(" ")}` });
    return { success: true, exitCode: null, stdout: `DRY RUN: ${[input, ...args].join(" ")}`, stderr: "", durationMs: dur };
  }

  // Build spawn arguments for PowerShell Core if available (pwsh) else fallback to powershell.exe on Windows
  const pwshCmd = process.platform === "win32" ? "pwsh" : "pwsh"; // prefer pwsh cross-platform; rely on environment
  const useFile = isPathToPs1(input);
  const spawnArgs = useFile
    ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.resolve(input.split(" ")[0]), ...args]
    : ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", input + (args.length ? " " + args.map(a => JSON.stringify(a)).join(" ") : "")];

  let child: ChildProcessWithoutNullStreams;
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let timedOut = false;
  const t0 = Date.now();

  try {
    child = spawn(pwshCmd, spawnArgs, { windowsHide: true });

    const killTimer = setTimeout(() => {
      try {
        timedOut = true;
        child.kill("SIGKILL");
      } catch { /* ignore */ }
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => { stdout += d; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => { stderr += d; });

    await new Promise<void>((resolve, reject) => {
      child.on("error", (err) => {
        clearTimeout(killTimer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(killTimer);
        exitCode = typeof code === "number" ? code : null;
        resolve();
      });
    });

    const durationMs = Date.now() - t0;
    let parsed: any = undefined;
    try {
      const trimmed = stdout.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        parsed = JSON.parse(trimmed);
      }
    } catch {
      // ignore parse errors
    }

    const success = exitCode === 0 && !timedOut;
    if (execLogId > 0) {
      await updateExecutionLog(execLogId, {
        finished_at: new Date().toISOString(),
        success: success ? 1 : 0,
        output: stdout || null,
        error: stderr || null,
      });
    }

    return { success, exitCode, stdout, stderr, timedOut: Boolean(timedOut), durationMs, parsed };
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    const errStr = String(err?.message ?? err);
    if (execLogId > 0) {
      await updateExecutionLog(execLogId, {
        finished_at: new Date().toISOString(),
        success: 0,
        output: stdout || null,
        error: errStr,
      });
    }
    return { success: false, exitCode, stdout, stderr: stderr || errStr, timedOut: Boolean(timedOut), durationMs };
  }
}
