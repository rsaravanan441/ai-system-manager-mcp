export async function scanVSCode(path: string) {
  try {
    return { tool: "scanVSCode", path, found: false };
  } catch (err) {
    return { tool: "scanVSCode", path, error: String(err) };
  }
}
