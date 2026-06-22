export async function scanVSCode(path: string) {
  return { type: "vscode", path, found: false };
}
