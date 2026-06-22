#!/usr/bin/env bash
set -e

ROOT="ai-system-manager-mcp"
if [ -d "$ROOT" ]; then
  echo "$ROOT already exists. Exiting to avoid overwriting."
  exit 1
fi

mkdir -p "$ROOT/src/tools"
mkdir -p "$ROOT/src/services"
mkdir -p "$ROOT/config"
mkdir -p "$ROOT/database"

# Write files
cat > "$ROOT/package.json" <<'JSON'
{
  "name": "ai-system-manager-mcp",
  "version": "0.1.0",
  "private": true,
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "ts-node": "^10.0.0"
  }
}
JSON

cat > "$ROOT/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
JSON

cat > "$ROOT/.gitignore" <<'TXT'
node_modules/
dist/
.env
.DS_Store
TXT

cat > "$ROOT/README.md" <<'MD'
# ai-system-manager-mcp

Skeleton project for system scanning utilities.

Run:
1. npm install
2. npm run build
3. npm start

Or for development:
npm run dev
MD

# config
cat > "$ROOT/config/settings.json" <<'JSON'
{
  "port": 3000,
  "database": "database/cleanup.db"
}
JSON

# server
cat > "$ROOT/src/server.ts" <<'TS'
import { createServer } from "http";
import { getDbPath } from "./services/database";
import { scanNode } from "./tools/scanNode";

const PORT = Number(process.env.PORT || 3000);

const server = createServer(async (req, res) => {
  if (req.url === "/scan-node") {
    const result = await scanNode("./");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result, db: getDbPath() }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ai-system-manager-mcp running");
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
TS

# tools
cat > "$ROOT/src/tools/scanNode.ts" <<'TS'
export async function scanNode(path: string) {
  // placeholder: implement scanning logic to look for package.json, node_modules, etc.
  return { type: "node", path, found: false, notes: "Implement scanner logic" };
}
TS

cat > "$ROOT/src/tools/scanPython.ts" <<'TS'
export async function scanPython(path: string) {
  return { type: "python", path, found: false };
}
TS

cat > "$ROOT/src/tools/scanDotnet.ts" <<'TS'
export async function scanDotnet(path: string) {
  return { type: "dotnet", path, found: false };
}
TS

cat > "$ROOT/src/tools/scanNuget.ts" <<'TS'
export async function scanNuget(path: string) {
  return { type: "nuget", path, found: false };
}
TS

cat > "$ROOT/src/tools/scanStorage.ts" <<'TS'
export async function scanStorage(path: string) {
  return { type: "storage", path, found: false };
}
TS

cat > "$ROOT/src/tools/scanVisualStudio.ts" <<'TS'
export async function scanVisualStudio(path: string) {
  return { type: "visualstudio", path, found: false };
}
TS

cat > "$ROOT/src/tools/scanVSCode.ts" <<'TS'
export async function scanVSCode(path: string) {
  return { type: "vscode", path, found: false };
}
TS

cat > "$ROOT/src/tools/removeItem.ts" <<'TS'
import { promises as fs } from "fs";

export async function removeItem(path: string) {
  try {
    await fs.rm(path, { recursive: true, force: true });
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
TS

# services
cat > "$ROOT/src/services/database.ts" <<'TS'
import path from "path";
import fs from "fs";

export function getDbPath(): string {
  // resolves db path relative to project root (can be adjusted)
  return path.resolve(process.cwd(), "database", "cleanup.db");
}

export function ensureDbFile() {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    // create an empty file; if you want an sqlite DB, initialize it with sqlite3
    fs.writeFileSync(dbPath, "");
  }
  return dbPath;
}
TS

cat > "$ROOT/src/services/powershell.ts" <<'TS'
export async function runPowerShell(script: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  // placeholder: implement call to powershell (child_process) on Windows
  return { ok: false, error: "Not implemented: launching powershell requires child_process and platform checks" };
}
TS

# create an empty db file (or you can initialize with sqlite3)
touch "$ROOT/database/cleanup.db"

echo "Repository skeleton created at $ROOT"
echo "Next steps:"
echo "  cd $ROOT"
echo "  npm install"
echo "  npm run build   # to compile TypeScript"
echo "  npm start       # to run compiled server"
