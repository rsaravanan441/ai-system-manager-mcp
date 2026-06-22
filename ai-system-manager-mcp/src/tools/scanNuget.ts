export async function scanNuget(path: string) {
  return { type: "nuget", path, found: false };
}
