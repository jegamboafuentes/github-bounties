import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBountiesMcpServer } from "./mcp";
import type { PublicReadApi } from "./service";

const BOUNTY_ID = "00000000-0000-4000-8000-000000000022";

function textOf(result: { content: unknown }): string {
  const content = result.content;
  assert.ok(Array.isArray(content));
  const first = content[0] as { type?: string; text?: string };
  assert.equal(first.type, "text");
  assert.equal(typeof first.text, "string");
  return first.text ?? "";
}

describe("MCP read tools", () => {
  it("lists the five read tools and list_bounties returns data", async () => {
    const api: PublicReadApi = {
      async listBounties(input) {
        assert.equal(input.limit, 2);
        assert.equal(input.sort, "newest");
        return {
          data: [
            {
              id: BOUNTY_ID,
              issue: {
                url: "https://github.com/octo/hello/issues/42",
                repo: "octo/hello",
                number: 42,
                title: "Seed bounty",
              },
              status: "funded",
              currency: "USDC",
              amountUsdc: "100.000000",
              totalFundedUsdc: "100.000000",
              createdAt: "2026-09-01T00:00:00.000Z",
              fundedAt: "2026-09-01T00:00:00.000Z",
              payout: {
                faceUsdc: "100.000000",
                feeUsdc: "2.000000",
                feeBps: 200,
                poolBpsOfPostFee: 1500,
                winnerUsdc: "98.000000",
                poolTotalUsdc: "0.000000",
                eachUsdc: null,
                eligibleCount: 0,
                emptyPool: true,
                schedule: "empty_pool",
              },
              intelligence: null,
              funders: { count: 1, avatars: [{ displayName: "Ada", avatarUrl: null }] },
              poster: { displayName: "Ada Maintainer", githubLogin: "ada-maintainer" },
            },
          ],
          page: { limit: 2, sort: "newest", nextCursor: null },
        };
      },
      async getBounty() {
        throw new Error("not used");
      },
      async listFunders() {
        throw new Error("not used");
      },
      async getIntelligence() {
        throw new Error("not used");
      },
      async getStats() {
        return {
          ok: true as const,
          schemaVersion: 2 as const,
          generatedAt: "2026-09-01T00:00:00.000Z",
          product: "GitHub Bounties" as const,
          currency: "USDC" as const,
          buckets: {
            open: ["pending_fund", "funded", "claim_locked"],
            completed: ["settled", "settled_partial"],
            closed: ["refunded", "cancelled", "expired", "void"],
            inFlight: ["settling", "refunding"],
          },
          bounties: {
            total: 1,
            open: 1,
            completed: 0,
            closed: 0,
            inFlight: 0,
            byStatus: {
              pending_fund: 0,
              funded: 1,
              claim_locked: 0,
              settling: 0,
              settled: 0,
              settled_partial: 0,
              refunding: 0,
              refunded: 0,
              void: 0,
              cancelled: 0,
              expired: 0,
            },
          },
          volumeUsdc: {
            transacted: "0.000000",
            outstandingOpen: "0.000000",
            outstandingInFlight: "0.000000",
            completed: "0.000000",
          },
          developers: { participated: 0, githubLinked: 0 },
          repos: { withBounties: 1, total: 1 },
        };
      },
    };

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createBountiesMcpServer(api);
    const client = new Client({ name: "v4-1-test", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        "cancel_bounty",
        "claim_pool",
        "claim_winner",
        "clear_work_signal",
        "create_bounty",
        "fund_bounty",
        "get_bounty",
        "get_bounty_claims",
        "get_bounty_intelligence",
        "get_me",
        "get_stats",
        "list_bounties",
        "list_funders",
        "list_my_bounties",
        "list_my_claims",
        "refund_bounty",
        "signal_working",
        "top_up_bounty",
      ],
    );
    for (const name of ["claim_winner", "claim_pool", "refund_bounty", "fund_bounty", "top_up_bounty"]) {
      const tool = listed.tools.find((item) => item.name === name);
      assert.match(tool?.description ?? "", /^Requires API key with money scope; DEV only/);
    }
    for (const name of ["get_me", "list_my_bounties", "get_bounty_claims", "list_my_claims"]) {
      const tool = listed.tools.find((item) => item.name === name);
      assert.match(tool?.description ?? "", /^Requires API key \(read scope\)/);
    }
    const listTool = listed.tools.find((tool) => tool.name === "list_bounties");
    assert.match(listTool?.description ?? "", /has_intel/);
    assert.match(listTool?.description ?? "", /totalFundedUsdc/);
    assert.match(listTool?.description ?? "", /newest contribution first/);
    assert.equal(typeof listTool?.inputSchema, "object");
    const bountyTool = listed.tools.find((tool) => tool.name === "get_bounty");
    assert.match(bountyTool?.description ?? "", /totalFundedUsdc/);
    const fundersTool = listed.tools.find((tool) => tool.name === "list_funders");
    assert.match(fundersTool?.description ?? "", /newest first/);
    assert.doesNotMatch(fundersTool?.description ?? "", /oldest first/);

    const result = await client.callTool({ name: "list_bounties", arguments: { limit: 2 } });
    const payload = JSON.parse(textOf(result)) as { data: { id: string; issue: { title: string } }[] };
    assert.equal(payload.data.length, 1);
    assert.equal(payload.data[0]?.id, BOUNTY_ID);
    assert.equal(payload.data[0]?.issue.title, "Seed bounty");

    await client.close();
    await server.close();
  });
});
