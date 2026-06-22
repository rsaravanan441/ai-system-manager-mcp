export async function scanPython(path: string) {
  return { type: "python", path, found: false };
}
