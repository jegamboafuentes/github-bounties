import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

export const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api/health")) {
    json(res, 200, {
      ok: true,
      service: "github-bounties-hello",
      product: "GitHub Bounties",
      project: "github-bounties",
    });
    return;
  }
  json(res, 404, { ok: false, error: "not_found" });
});

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  server.listen(port, host, () => {
    console.log(`github-bounties-hello listening on ${host}:${port}`);
  });
}
