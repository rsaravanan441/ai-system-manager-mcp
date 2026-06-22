export async function scanVisualStudio(path: string) {
  return { type: "visualstudio", path, found: false };
}
