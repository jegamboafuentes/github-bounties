import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAuthedMcpTools } from "../api/access/mcp-tools";
import type { AccessDeps, MeProfile } from "../api/access/deps";
import type { ApiPrincipal } from "../api/access/handlers";
import type { McpAccess } from "../api/access/http";
import { PUBLIC_API_VERSION } from "../api/public/version";
import type { LinkedAccounts } from "../profile/settings";

const LINKED_AT = "2026-10-02T15:04:05.000Z";

function textOf(result: { content: unknown }): string {
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0] as { type?: string; text?: string };
  assert.equal(first.type, "text");
  return first.text ?? "";
}

function principal(scopes: Array<"read" | "write" | "money">): ApiPrincipal {
  return {
    keyId: "key-1",
    userId: "user-1",
    name: "qa",
    env: "test",
    prefix: "gb_test_",
    scopes: new Set(scopes),
    perTxCapUsdc: "50.000000",
    dailyCapUsdc: "200.000000",
  };
}

function deps(huggingface: LinkedAccounts["huggingface"]): AccessDeps {
  const me: MeProfile = {
    id: "user-1",
    displayName: "Ada",
    email: "ada@example.com",
    walletAddress: "0x1111111111111111111111111111111111111111",
    githubLogin: "ada",
    huggingface,
  };
  const linked: LinkedAccounts = {
    google: { email: "ada@example.com" },
    github: { login: "ada", id: "583231", linkedAt: "2026-09-01T00:00:00.000Z" },
    huggingface,
    wallet: { address: me.walletAddress },
  };
  return new Proxy({} as AccessDeps, {
    get(_target, prop) {
      if (prop === "env") return {};
      if (prop === "now") return () => new Date("2026-10-02T15:04:05.000Z");
      if (prop === "insertRequest") return async () => "log-1";
      if (prop === "countRequests") return async () => 1;
      if (prop === "updateRequestStatus") return async () => {};
      if (prop === "loadMe") return async () => me;
      if (prop === "loadLinkedAccounts") return async () => linked;
      return () => {
        throw new Error(`unexpected dep ${String(prop)}`);
      };
    },
  });
}

async function callTool(
  name: "get_me" | "list_linked_accounts",
  scopes: Array<"read" | "write" | "money">,
  huggingface: LinkedAccounts["huggingface"],
) {
  const server = new McpServer({ name: "github-bounties", version: PUBLIC_API_VERSION });
  const access: McpAccess = {
    principal: principal(scopes),
    deps: deps(huggingface),
    ip: "127.0.0.1",
    origin: "https://dev.githubbounties.xyz",
  };
  registerAuthedMcpTools(server, access);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hf-payload", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const result = await client.callTool({ name, arguments: {} });
  await client.close();
  await server.close();
  return result;
}

describe("MCP Hugging Face linked account payload", () => {
  it("returns huggingface on get_me and list_linked_accounts with the read scope", async () => {
    const huggingface = { username: "lysandre", linkedAt: LINKED_AT };
    const me = await callTool("get_me", ["read"], huggingface);
    assert.equal(me.isError, false);
    const meBody = JSON.parse(textOf(me)) as {
      githubLogin: string;
      huggingface: { username: string; linkedAt: string } | null;
    };
    assert.equal(meBody.githubLogin, "ada");
    assert.deepEqual(meBody.huggingface, huggingface);

    const accounts = await callTool("list_linked_accounts", ["read"], huggingface);
    assert.equal(accounts.isError, false);
    const body = JSON.parse(textOf(accounts)) as {
      github: { login: string; id: string; linkedAt: string };
      huggingface: { username: string; linkedAt: string } | null;
      google: { email: string };
    };
    assert.equal(body.github.login, "ada");
    assert.equal(body.github.id, "583231");
    assert.equal(body.google.email, "ada@example.com");
    assert.deepEqual(body.huggingface, huggingface);

    const empty = await callTool("list_linked_accounts", ["read"], null);
    const emptyBody = JSON.parse(textOf(empty)) as { huggingface: null; github: { login: string } };
    assert.equal(emptyBody.huggingface, null);
    assert.equal(emptyBody.github.login, "ada");

    const meEmpty = await callTool("get_me", ["read"], null);
    const meEmptyBody = JSON.parse(textOf(meEmpty)) as { huggingface: null; githubLogin: string };
    assert.equal(meEmptyBody.huggingface, null);
    assert.equal(meEmptyBody.githubLogin, "ada");
  });

  it("uses the same read-scope error as GitHub linked accounts", async () => {
    for (const name of ["get_me", "list_linked_accounts"] as const) {
      const denied = await callTool(name, ["write"], null);
      assert.equal(denied.isError, true);
      const body = JSON.parse(textOf(denied)) as { error: { code: string; message: string; details: unknown } };
      assert.equal(body.error.code, "forbidden_scope");
      assert.deepEqual(body.error.details, { required: "read" });
    }
  });
});
