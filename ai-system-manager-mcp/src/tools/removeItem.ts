import { promises as fs } from "fs";

export async function removeItem(path: string) {
  try {
    await fs.rm(path, { recursive: true, force: true });
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
