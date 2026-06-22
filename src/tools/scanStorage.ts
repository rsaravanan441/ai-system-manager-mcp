export async function scanStorage(rootPaths: string[] = []) {
  try {
    return { tool: "scanStorage", roots: rootPaths, found: false };
  } catch (err) {
    return { tool: "scanStorage", error: String(err) };
  }
}
