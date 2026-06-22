export async function scanNuget(path: string) {
  try {
    return { tool: "scanNuget", path, found: false };
  } catch (err) {
    return { tool: "scanNuget", path, error: String(err) };
  }
}
