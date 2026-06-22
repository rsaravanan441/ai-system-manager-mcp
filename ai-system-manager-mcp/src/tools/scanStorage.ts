export async function scanStorage(path: string) {
  return { type: "storage", path, found: false };
}
