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