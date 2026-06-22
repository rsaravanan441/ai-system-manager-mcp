export async function scanDotnet(path: string) {
  return { type: "dotnet", path, found: false };
}
