export async function scanNode(path: string) {
  // placeholder: implement scanning logic to look for package.json, node_modules, npm/pnpm/yarn caches
  try {
    return { tool: "scanNode", path, found: false, notes: "Implement scanner logic" };
  } catch (err) {
    return { tool: "scanNode", path, error: String(err) };
  }
}
