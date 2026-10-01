import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBountiesMcpServer } from "../public/mcp";
import type { PublicReadApi } from "../public/service";
import { buildOpenApiDocument, PUBLIC_API_DESCRIPTION } from "../public/schemas";
import { apiMoneyEnabled } from "./policy";
import {
  MONEY_ACTIONS_DISABLED,
  MONEY_OPERATION_PATHS,
  apiKeyRequiredMessage,
  applyInfoMoneyStatus,
  moneyScopeRequirement,
} from "./money-wording";

const catalogApi: PublicReadApi = {
  async listBounties() {
    throw new Error("unused");
  },
  async getBounty() {
    throw new Error("unused");
  },
  async listFunders() {
    throw new Error("unused");
  },
  async getIntelligence() {
    throw new Error("unused");
  },
  async getStats() {
    throw new Error("unused");
  },
};

const MONEY_TOOLS = ["fund_bounty", "top_up_bounty", "claim_winner", "claim_pool", "refund_bounty"] as const;

async function withMoneyEnv(env: Record<string, string | undefined>, run: () => Promise<void>) {
  const keys = ["API_MONEY_ENABLED", "CDP_NETWORK"] as const;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) previous.set(key, process.env[key]);
  try {
    for (const key of keys) {
      const value = env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function moneyToolDescriptions(): Promise<Map<string, string>> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBountiesMcpServer(catalogApi);
  const client = new Client({ name: "money-wording", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    return new Map(listed.tools.map((tool) => [tool.name, tool.description ?? ""]));
  } finally {
    await client.close();
    await server.close();
  }
}

async function anonymousMoneyMessage(): Promise<string> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createBountiesMcpServer(catalogApi);
  const client = new Client({ name: "money-wording", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const denied = await client.callTool({
      name: "fund_bounty",
      arguments: { id: "00000000-0000-4000-8000-000000000001", idempotencyKey: "fund-anon" },
    });
    const content = denied.content as Array<{ text?: string }>;
    const body = JSON.parse(content[0]?.text ?? "") as { error: { message: string } };
    return body.error.message;
  } finally {
    await client.close();
    await server.close();
  }
}

describe("money wording follows API_MONEY_ENABLED", () => {
  it("says nothing about the gate when money is on, and names the disabled deployment when it is off", async () => {
    assert.equal(moneyScopeRequirement(true), "Requires API key with money scope.");
    assert.equal(
      moneyScopeRequirement(false),
      `Requires API key with money scope. ${MONEY_ACTIONS_DISABLED}`,
    );
    assert.doesNotMatch(PUBLIC_API_DESCRIPTION, /DEV only|DEV-only/);
    assert.doesNotMatch(PUBLIC_API_DESCRIPTION, new RegExp(MONEY_ACTIONS_DISABLED));
    assert.match(
      applyInfoMoneyStatus(PUBLIC_API_DESCRIPTION, false),
      new RegExp(`top-up\\. ${MONEY_ACTIONS_DISABLED}`),
    );

    await withMoneyEnv({ CDP_NETWORK: "base-sepolia", API_MONEY_ENABLED: "1" }, async () => {
      assert.equal(apiMoneyEnabled(), true);
      const tools = await moneyToolDescriptions();
      for (const name of MONEY_TOOLS) {
        const description = tools.get(name) ?? "";
        assert.match(description, /^Requires API key with money scope\./, name);
        assert.doesNotMatch(description, /DEV only/, name);
        assert.doesNotMatch(description, new RegExp(MONEY_ACTIONS_DISABLED), name);
      }
      const message = await anonymousMoneyMessage();
      assert.equal(message, apiKeyRequiredMessage("money", true));
      assert.doesNotMatch(message, /DEV only/);
      assert.doesNotMatch(message, new RegExp(MONEY_ACTIONS_DISABLED));

      const document = buildOpenApiDocument({ env: { CDP_NETWORK: "base-sepolia", API_MONEY_ENABLED: "1" } });
      assert.doesNotMatch(document.info.description ?? "", /DEV only|DEV-only/);
      assert.doesNotMatch(document.info.description ?? "", new RegExp(MONEY_ACTIONS_DISABLED));
      for (const path of MONEY_OPERATION_PATHS) {
        const description = document.paths?.[path]?.post?.description ?? "";
        assert.match(description, /^Scope money\./, path);
        assert.doesNotMatch(description, /DEV only/, path);
        assert.doesNotMatch(description, new RegExp(MONEY_ACTIONS_DISABLED), path);
      }
    });

    await withMoneyEnv({ CDP_NETWORK: "base", API_MONEY_ENABLED: "0" }, async () => {
      assert.equal(apiMoneyEnabled(), false);
      const tools = await moneyToolDescriptions();
      for (const name of MONEY_TOOLS) {
        const description = tools.get(name) ?? "";
        assert.match(description, new RegExp(`^Requires API key with money scope\\. ${MONEY_ACTIONS_DISABLED}`), name);
        assert.doesNotMatch(description, /DEV only/, name);
      }
      const message = await anonymousMoneyMessage();
      assert.equal(message, apiKeyRequiredMessage("money", false));
      assert.match(message, new RegExp(MONEY_ACTIONS_DISABLED));
      assert.doesNotMatch(message, /DEV only/);

      const document = buildOpenApiDocument({ env: { CDP_NETWORK: "base", API_MONEY_ENABLED: "0" } });
      assert.match(document.info.description ?? "", new RegExp(MONEY_ACTIONS_DISABLED));
      assert.doesNotMatch(document.info.description ?? "", /DEV only|DEV-only/);
      for (const path of MONEY_OPERATION_PATHS) {
        const description = document.paths?.[path]?.post?.description ?? "";
        assert.match(description, new RegExp(`^Scope money\\. ${MONEY_ACTIONS_DISABLED}`), path);
        assert.doesNotMatch(description, /DEV only/, path);
      }
    });
  });
});
