export async function scanVisualStudio(path: string) {
  try {
    return { tool: "scanVisualStudio", path, found: false };
  } catch (err) {
    return { tool: "scanVisualStudio", path, error: String(err) };
  }
}
