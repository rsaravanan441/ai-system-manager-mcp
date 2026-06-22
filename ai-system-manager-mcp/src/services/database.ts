/**
 * src/services/database.ts
 *
 * SQLite-backed persistence layer for AI System Manager MCP.
 *
 * Responsibilities:
 * - Initialize SQLite database and required schema (scans, recommendations, approvals, execution_logs).
 * - Provide strongly-typed methods to record/query scan results, recommendations, approvals, and execution logs.
 * - Enforce safe defaults (WAL journal, busy timeout) and robust error handling.
 *
 * Notes:
 * - This implementation uses `better-sqlite3` for simple, reliable synchronous access suitable for desktop utilities.
 * - All I/O is local and synchronous by design to avoid subtle async concurrency issues with SQLite on desktop apps.
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export type UUID = string;

export type ScanRecord = {
  id?: number;
  task_id: UUID | null;
  tool: string;
  started_at: string; // ISO
  finished_at?: string | null; // ISO
  status: "ok" | "partial" | "error";
  summary: string; // short JSON/string summary
  details?: string | null; // JSON stringified details
};

export type RecommendationRecord = {
  id?: number;
  scan_id?: number | null;
  item_type: string; // e.g., "nuget-package", "folder", "dotnet-sdk"
  item_key: string; // machine-unique key/path
  classification: "SAFE_TO_REMOVE" | "SAFE_TO_ARCHIVE" | "UPDATE_RECOMMENDED" | "KEEP" | "REVIEW";
  confidence: number; // 0-100
  reasoning: string;
  estimated_savings_bytes?: number | null;
  created_at?: string; // ISO
  metadata?: string | null; // JSON string with additional fields (risk score, storage impact)
};

export type ApprovalRecord = {
  id?: number;
  recommendation_id: number;
  approved_by?: string | null;
  approved_at?: string | null; // ISO
  confirmation_token?: string | null;
  dry_run: 0 | 1;
  comment?: string | null;
};

export type ExecutionLog = {
  id?: number;
  recommendation_id?: number | null;
  action: string;
  command?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  success: 0 | 1;
  output?: string | null;
  error?: string | null;
  rollback_metadata?: string | null; // JSON string
};

class DatabaseService {
  private db!: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    // default database path relative to project root
    this.dbPath = dbPath
      ? path.resolve(dbPath)
      : path.resolve(process.cwd(), "database", "cleanup.db");
    this.ensureDirectory();
    this.connect();
    this.migrate();
  }

  private ensureDirectory() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private connect() {
    try {
      // Open DB with sensible defaults
      this.db = new Database(this.dbPath, {
        fileMustExist: false,
        verbose: undefined,
      });

      // Pragmas for better concurrency and durability on desktop
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
      this.db.pragma("foreign_keys = ON");
      this.db.pragma("busy_timeout = 5000"); // 5 seconds
    } catch (err) {
      // Re-throw with context
      throw new Error(`Failed to open SQLite DB at ${this.dbPath}: ${String(err)}`);
    }
  }

  /**
   * Ensures required tables exist. Safe to call multiple times.
   */
  private migrate() {
    const createScans = `
      CREATE TABLE IF NOT EXISTS scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NULL,
        tool TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        details TEXT NULL
      );
    `;

    const createRecommendations = `
      CREATE TABLE IF NOT EXISTS recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id INTEGER NULL REFERENCES scans(id) ON DELETE SET NULL,
        item_type TEXT NOT NULL,
        item_key TEXT NOT NULL,
        classification TEXT NOT NULL,
        confidence INTEGER NOT NULL,
        reasoning TEXT NOT NULL,
        estimated_savings_bytes INTEGER NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_recommendations_item ON recommendations(item_type, item_key);
    `;

    const createApprovals = `
      CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recommendation_id INTEGER NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
        approved_by TEXT NULL,
        approved_at TEXT NULL,
        confirmation_token TEXT NULL,
        dry_run INTEGER NOT NULL DEFAULT 1,
        comment TEXT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_recommendation ON approvals(recommendation_id);
    `;

    const createExecutionLogs = `
      CREATE TABLE IF NOT EXISTS execution_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recommendation_id INTEGER NULL REFERENCES recommendations(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        command TEXT NULL,
        started_at TEXT NULL,
        finished_at TEXT NULL,
        success INTEGER NOT NULL DEFAULT 0,
        output TEXT NULL,
        error TEXT NULL,
        rollback_metadata TEXT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_execution_recommendation ON execution_logs(recommendation_id);
    `;

    const tx = this.db.transaction(() => {
      this.db.exec(createScans);
      this.db.exec(createRecommendations);
      this.db.exec(createApprovals);
      this.db.exec(createExecutionLogs);
    });

    try {
      tx();
    } catch (err) {
      throw new Error(`Database migration failed: ${String(err)}`);
    }
  }

  // -------------------------
  // Scans
  // -------------------------
  createScan(scan: Omit<ScanRecord, "id">): number {
    const stmt = this.db.prepare(
      `INSERT INTO scans (task_id, tool, started_at, finished_at, status, summary, details)
       VALUES (@task_id, @tool, @started_at, @finished_at, @status, @summary, @details)`
    );
    const info = stmt.run({
      task_id: scan.task_id,
      tool: scan.tool,
      started_at: scan.started_at,
      finished_at: scan.finished_at ?? null,
      status: scan.status,
      summary: scan.summary,
      details: scan.details ?? null,
    });
    return Number(info.lastInsertRowid);
  }

  updateScanFinished(scanId: number, finished_at: string, status: ScanRecord["status"], summary?: string, details?: string) {
    const stmt = this.db.prepare(
      `UPDATE scans SET finished_at = @finished_at, status = @status, summary = COALESCE(@summary, summary), details = COALESCE(@details, details) WHERE id = @id`
    );
    stmt.run({ finished_at, status, summary: summary ?? null, details: details ?? null, id: scanId });
  }

  getScanById(id: number): ScanRecord | null {
    const row = this.db.prepare(`SELECT * FROM scans WHERE id = ?`).get(id);
    return row ?? null;
  }

  listScans(limit = 50, offset = 0): ScanRecord[] {
    return this.db.prepare(`SELECT * FROM scans ORDER BY started_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as ScanRecord[];
  }

  // -------------------------
  // Recommendations
  // -------------------------
  createRecommendation(rec: Omit<RecommendationRecord, "id" | "created_at">): number {
    const stmt = this.db.prepare(
      `INSERT INTO recommendations (scan_id, item_type, item_key, classification, confidence, reasoning, estimated_savings_bytes, metadata)
       VALUES (@scan_id, @item_type, @item_key, @classification, @confidence, @reasoning, @estimated_savings_bytes, @metadata)`
    );
    const info = stmt.run({
      scan_id: rec.scan_id ?? null,
      item_type: rec.item_type,
      item_key: rec.item_key,
      classification: rec.classification,
      confidence: Math.max(0, Math.min(100, Math.round(rec.confidence))),
      reasoning: rec.reasoning,
      estimated_savings_bytes: rec.estimated_savings_bytes ?? null,
      metadata: rec.metadata ?? null,
    });
    return Number(info.lastInsertRowid);
  }

  getRecommendationById(id: number): RecommendationRecord | null {
    const row = this.db.prepare(`SELECT * FROM recommendations WHERE id = ?`).get(id);
    return row ?? null;
  }

  listRecommendations(limit = 100, offset = 0): RecommendationRecord[] {
    return this.db.prepare(`SELECT * FROM recommendations ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as RecommendationRecord[];
  }

  // -------------------------
  // Approvals
  // -------------------------
  createApproval(approval: Omit<ApprovalRecord, "id">): number {
    const stmt = this.db.prepare(
      `INSERT INTO approvals (recommendation_id, approved_by, approved_at, confirmation_token, dry_run, comment)
       VALUES (@recommendation_id, @approved_by, @approved_at, @confirmation_token, @dry_run, @comment)`
    );
    const info = stmt.run({
      recommendation_id: approval.recommendation_id,
      approved_by: approval.approved_by ?? null,
      approved_at: approval.approved_at ?? null,
      confirmation_token: approval.confirmation_token ?? null,
      dry_run: approval.dry_run,
      comment: approval.comment ?? null,
    });
    return Number(info.lastInsertRowid);
  }

  getApprovalById(id: number): ApprovalRecord | null {
    const row = this.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id);
    return row ?? null;
  }

  listApprovals(limit = 50, offset = 0): ApprovalRecord[] {
    return this.db.prepare(`SELECT * FROM approvals ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset) as ApprovalRecord[];
  }

  // -------------------------
  // Execution logs
  // -------------------------
  createExecutionLog(log: Omit<ExecutionLog, "id">): number {
    const stmt = this.db.prepare(
      `INSERT INTO execution_logs (recommendation_id, action, command, started_at, finished_at, success, output, error, rollback_metadata)
       VALUES (@recommendation_id, @action, @command, @started_at, @finished_at, @success, @output, @error, @rollback_metadata)`
    );
    const info = stmt.run({
      recommendation_id: log.recommendation_id ?? null,
      action: log.action,
      command: log.command ?? null,
      started_at: log.started_at ?? null,
      finished_at: log.finished_at ?? null,
      success: log.success,
      output: log.output ?? null,
      error: log.error ?? null,
      rollback_metadata: log.rollback_metadata ?? null,
    });
    return Number(info.lastInsertRowid);
  }

  listExecutionLogs(limit = 100, offset = 0): ExecutionLog[] {
    return this.db.prepare(`SELECT * FROM execution_logs ORDER BY id DESC LIMIT ? OFFSET ?`).all(limit, offset) as ExecutionLog[];
  }

  // Generic helper: close DB (for tests / graceful shutdown)
  close() {
    try {
      this.db.close();
    } catch (err) {
      // log but don't throw during shutdown
      // In a production system you'd wire this into the app logger
      // console.warn("Database close error:", err);
    }
  }
}

// Export a singleton instance that's safe to import from other modules.
// Consumers may create their own DatabaseService(dbPath) for testing.
const defaultDbPath = process.env.ASM_DB_PATH || path.resolve(process.cwd(), "database", "cleanup.db");
const dbService = new DatabaseService(defaultDbPath);
export default dbService;
export { DatabaseService };