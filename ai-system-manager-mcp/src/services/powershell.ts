export async function runPowerShell(script: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  // placeholder: implement call to powershell (child_process) on Windows
  return { ok: false, error: "Not implemented: launching powershell requires child_process and platform checks" };
}
