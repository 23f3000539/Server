// Minimal MCP server (Streamable HTTP, stateless, JSON responses). No dependencies.
const http = require("http");
const crypto = require("crypto");

const EMAIL = "23f3000539@ds.study.iitm.ac.in".trim().toLowerCase();
const PORT = process.env.PORT || 3000;
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

function answer(challenge) {
  return crypto.createHash("sha256").update(`${challenge}:${EMAIL}`).digest("hex").slice(0, 16);
}

function handle(msg, headers) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  if (isNotification) return null; // notifications/initialized etc.

  switch (method) {
    case "initialize": {
      const want = params && params.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "challenge-server", version: "1.0.0" },
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({
        tools: [{
          name: "solve_challenge",
          description: "Reads the exam challenge from the HTTP headers and returns the answer.",
          inputSchema: { type: "object", properties: {} },
        }],
      });
    case "tools/call": {
      if (!params || params.name !== "solve_challenge") return err(-32602, "Unknown tool");
      const challenge = (headers["x-exam-challenge"] || "").toString().trim();
      if (!challenge) {
        return ok({ content: [{ type: "text", text: "missing X-Exam-Challenge header" }], isError: true });
      }
      return ok({ content: [{ type: "text", text: answer(challenge) }] });
    }
    default:
      return err(-32601, `Method not found: ${method}`);
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (req.method === "GET" && (url === "/" || url === "/health")) {
    res.writeHead(200, { ...CORS, "Content-Type": "text/plain" });
    return res.end("ok");
  }
  if (url !== "/mcp" && url !== "/") { res.writeHead(404, CORS); return res.end(); }
  if (req.method !== "POST") { res.writeHead(405, { ...CORS, Allow: "POST" }); return res.end(); }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed;
    try { parsed = JSON.parse(body); }
    catch {
      res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
    }
    const batch = Array.isArray(parsed);
    const out = (batch ? parsed : [parsed]).map((m) => handle(m, req.headers)).filter(Boolean);
    if (out.length === 0) { res.writeHead(202, CORS); return res.end(); }
    res.writeHead(200, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify(batch ? out : out[0]));
  });
}).listen(PORT, () => console.log("MCP server listening on " + PORT));
