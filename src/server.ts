import { createServer } from "http";
import { scanNode } from "./tools/scanNode";
import db from "./services/database";
import settings from "../config/settings.json";

const PORT = Number(process.env.PORT || settings.port || 3000);

const server = createServer(async (req, res) => {
  try {
    if (!req) {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
      return;
    }

    if (req.url === "/scan-node") {
      const result = await scanNode("./");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, result }));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("AI System Manager MCP running");
  } catch (err: any) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
