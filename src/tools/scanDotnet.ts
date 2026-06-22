export async function scanDotnet(path: string) {
  try {
    return { tool: "scanDotnet", path, found: false };
  } catch (err) {
    return { tool: "scanDotnet", path, error: String(err) };
  }
}
