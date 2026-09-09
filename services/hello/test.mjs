import assert from "node:assert/strict";
import { server } from "./server.mjs";

function listenRandom() {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(addr.port);
    });
  });
}

async function get(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await res.json();
  return { status: res.status, body };
}

const port = await listenRandom();
try {
  for (const path of ["/", "/api/health"]) {
    const { status, body } = await get(port, path);
    assert.equal(status, 200, `${path} should be 200`);
    assert.equal(body.ok, true);
    assert.equal(body.service, "github-bounties-hello");
    assert.equal(body.product, "GitHub Bounties");
    assert.equal(body.project, "experiment-jegf");
  }
  const missing = await get(port, "/nope");
  assert.equal(missing.status, 404);
  console.log("hello health: GET / and GET /api/health → 200");
} finally {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
