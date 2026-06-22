export async function scanPython(path: string) {
  try {
    return { tool: "scanPython", path, found: false };
  } catch (err) {
    return { tool: "scanPython", path, error: String(err) };
  }
}
