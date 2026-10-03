import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { handleV1Action } from "../api/access/http";
import { createApiKey, listApiKeys } from "../api/access/handlers";
import { createAccessDeps } from "../api/access/store";
import { handleMcpHttp } from "../api/public/mcp-http";
import { createDb } from "../db/client";
import { closeRuntimeDb } from "../db/runtime";
import { loadDotenvFiles } from "../db/load-dotenv";
import { marketingContacts, users } from "../db/schema";
import { importMarketingContacts, importMarketingContactsFromCsv } from "./import";
import { recordGithubUsernameOnContact, recordSignupContact } from "./persist";
import type { UtmTouch } from "./utm";
import { applyResendUnsubscribe, markContactUnsubscribed } from "./resend";

loadDotenvFiles();

const MASTER_HEADER = "email,first_name,last_name,github_username,source,lb1_status,contact_type";
const SUPPRESSED_HEADER = `${MASTER_HEADER},suppression_reason`;

describe("marketing contacts", () => {
  it("imports idempotently, keeps an unsubscribe, and fills sign-up and GitHub fields", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const ada = `ada-${suffix}@example.com`;
    const grace = `grace-${suffix}@example.com`;
    const userId = randomUUID();
    try {
      const master = [MASTER_HEADER, `${ada},Ada,Lovelace,adal,lb1,active,hunter`, `${grace},Grace,Hopper,graceh,lb1,active,hunter`].join(
        "\n",
      );
      const suppressed = [SUPPRESSED_HEADER, `${ada},Ada,Lovelace,adal,lb1,active,hunter,bounce`].join("\n");
      const first = await importMarketingContactsFromCsv(db, { master, suppressed });
      assert.deepEqual(first, { inserted: 2, updated: 0, unsubscribed: 1 });
      const second = await importMarketingContactsFromCsv(db, { master, suppressed });
      assert.deepEqual(second, { inserted: 0, updated: 0, unsubscribed: 0 });

      const resubscribe = await importMarketingContacts(db, [
        {
          email: ada,
          firstName: "Ada",
          lastName: "Lovelace",
          githubUsername: "adal",
          source: "lb1",
          lb1Status: "active",
          contactType: "hunter",
          subscribed: true,
        },
      ]);
      assert.deepEqual(resubscribe, { inserted: 0, updated: 0, unsubscribed: 0 });
      const [suppressedRow] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, ada)).limit(1);
      assert.equal(suppressedRow?.subscribed, false);
      assert.ok(suppressedRow?.unsubscribedAt);

      await db.insert(users).values({
        id: userId,
        googleSub: `google-${suffix}`,
        email: ada,
        displayName: "Ada Lovelace",
      });
      await recordSignupContact(db, { id: userId, email: ` ${ada.toUpperCase()} `, displayName: "Ada Lovelace" });
      const [afterSignup] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, ada)).limit(1);
      assert.equal(afterSignup?.subscribed, false);
      assert.equal(afterSignup?.source, "both");
      assert.equal(afterSignup?.userId, userId);

      const newbieId = randomUUID();
      const newbieEmail = `new-${suffix}@example.com`;
      await db.insert(users).values({
        id: newbieId,
        googleSub: `google-new-${suffix}`,
        email: newbieEmail,
        displayName: "New Hunter",
      });
      await recordSignupContact(db, { id: newbieId, email: newbieEmail, displayName: "New Hunter" });
      const [created] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, newbieEmail)).limit(1);
      assert.equal(created?.source, "ghb");
      assert.equal(created?.subscribed, true);
      assert.equal(created?.firstName, "New");
      assert.equal(created?.lastName, "Hunter");

      await recordGithubUsernameOnContact(db, { userId: newbieId, githubUsername: "newhunt" });
      const [linked] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, newbieEmail)).limit(1);
      assert.equal(linked?.githubUsername, "newhunt");
      assert.equal(linked?.subscribed, true);

      const changed = await markContactUnsubscribed(db, newbieEmail, new Date(), "re_test");
      assert.equal(changed, true);
      const again = await applyResendUnsubscribe(
        db,
        { email: newbieEmail, resendId: "re_test", audienceId: "aud-1" },
        { audienceId: "aud-1" },
      );
      assert.equal(again, false);
      await recordSignupContact(db, { id: newbieId, email: newbieEmail, displayName: "New Hunter" });
      const [stillOff] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, newbieEmail)).limit(1);
      assert.equal(stillOff?.subscribed, false);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("copies first-touch attribution at sign-up and leaves it alone when GitHub is linked", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const email = `launch-${suffix}@example.com`;
    const userId = randomUUID();
    const now = new Date("2026-10-03T12:00:00.000Z");
    const touch: UtmTouch = {
      source: "lb_email",
      medium: "email",
      campaign: "ghb_launch_oct2026",
      content: "hero",
      term: null,
      path: "/",
      ts: "2026-10-03T00:00:00.000Z",
    };
    try {
      await db.insert(users).values({
        id: userId,
        googleSub: `google-utm-${suffix}`,
        email,
        displayName: "Launch Hunter",
      });
      await recordSignupContact(db, { id: userId, email, displayName: "Launch Hunter" }, now, touch);
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      assert.equal(user?.utmSource, "lb_email");
      assert.equal(user?.utmMedium, "email");
      assert.equal(user?.utmCampaign, "ghb_launch_oct2026");
      assert.equal(user?.utmContent, "hero");
      assert.equal(user?.utmTerm, null);
      assert.equal(user?.signupLandingPath, "/");
      assert.equal(user?.attributedAt?.toISOString(), now.toISOString());
      const [contact] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, email)).limit(1);
      assert.equal(contact?.utmSource, "lb_email");
      assert.equal(contact?.utmCampaign, "ghb_launch_oct2026");
      assert.equal(contact?.utmContent, "hero");

      const later: UtmTouch = { ...touch, campaign: "other_campaign", content: "footer", path: "/board" };
      await recordSignupContact(db, { id: userId, email, displayName: "Launch Hunter" }, new Date("2026-10-04T00:00:00.000Z"), later);
      const [userAgain] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      assert.equal(userAgain?.utmCampaign, "ghb_launch_oct2026");
      assert.equal(userAgain?.signupLandingPath, "/");
      const [contactAgain] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, email)).limit(1);
      assert.equal(contactAgain?.utmCampaign, "ghb_launch_oct2026");
      assert.equal(contactAgain?.utmContent, "hero");

      const importedEmail = `imported-${suffix}@example.com`;
      const importedUserId = randomUUID();
      await db.insert(users).values({
        id: importedUserId,
        googleSub: `google-imported-${suffix}`,
        email: importedEmail,
        displayName: "Imported Hunter",
      });
      await importMarketingContacts(db, [
        {
          email: importedEmail,
          firstName: "Imported",
          lastName: "Hunter",
          githubUsername: null,
          source: "lb1",
          lb1Status: null,
          contactType: null,
          subscribed: true,
        },
      ]);
      await recordSignupContact(
        db,
        { id: importedUserId, email: importedEmail, displayName: "Imported Hunter" },
        now,
        touch,
      );
      const [imported] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, importedEmail)).limit(1);
      assert.equal(imported?.source, "both");
      assert.equal(imported?.utmCampaign, "ghb_launch_oct2026");
      assert.equal(imported?.subscribed, true);

      await recordGithubUsernameOnContact(db, { userId, githubUsername: "@launchhunt" }, now);
      const [linked] = await db.select().from(marketingContacts).where(eq(marketingContacts.email, email)).limit(1);
      assert.equal(linked?.githubUsername, "launchhunt");
      assert.equal(linked?.utmCampaign, "ghb_launch_oct2026");
      assert.equal(linked?.utmContent, "hero");
      assert.equal(linked?.utmSource, "lb_email");
      const [userAfterGithub] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      assert.equal(userAfterGithub?.utmCampaign, "ghb_launch_oct2026");
      assert.equal(userAfterGithub?.attributedAt?.toISOString(), now.toISOString());
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps admin on a reloaded key for /me, REST contacts, and MCP contacts", async () => {
    const { db, sql } = createDb();
    const suffix = randomUUID().slice(0, 8);
    const email = `ada-${suffix}@example.com`;
    const userId = randomUUID();
    const deps = createAccessDeps(
      db,
      {
        ADMIN_EMAILS: email,
        API_KEY_HMAC_SECRET: "test-hmac-secret-value",
        CDP_NETWORK: "base-sepolia",
      },
      () => new Date("2026-10-03T00:00:00.000Z"),
    );
    try {
      await db.insert(users).values({
        id: userId,
        googleSub: `google-admin-${suffix}`,
        email,
        displayName: "Ada Admin",
      });
      const adminKey = await createApiKey({ userId, name: "admin-agent", scopes: ["read", "admin"] }, deps);
      const listed = await listApiKeys(userId, deps);
      assert.deepEqual(listed.find((key) => key.id === adminKey.key.id)?.scopes, ["read", "admin"]);

      const me = await handleV1Action(
        new Request("https://dev.githubbounties.xyz/api/v1/me", {
          headers: { authorization: `Bearer ${adminKey.token}` },
        }),
        { kind: "me" },
        deps,
      );
      assert.equal(me.status, 200);
      const meBody = (await me.json()) as { apiKey: { scopes: string[] } };
      assert.deepEqual(meBody.apiKey.scopes, ["read", "admin"]);

      const list = await handleV1Action(
        new Request("https://dev.githubbounties.xyz/api/v1/admin/contacts", {
          headers: { authorization: `Bearer ${adminKey.token}` },
        }),
        { kind: "admin-contacts" },
        deps,
      );
      assert.equal(list.status, 200);
      const listBody = (await list.json()) as { contacts: unknown[]; total: number };
      assert.equal(Array.isArray(listBody.contacts), true);
      assert.equal(typeof listBody.total, "number");

      const count = await handleV1Action(
        new Request("https://dev.githubbounties.xyz/api/v1/admin/contacts/count", {
          headers: { authorization: `Bearer ${adminKey.token}` },
        }),
        { kind: "admin-contacts-count" },
        deps,
      );
      assert.equal(count.status, 200);
      const countBody = (await count.json()) as { total: number; bySource: { ghb: number } };
      assert.equal(typeof countBody.total, "number");
      assert.equal(typeof countBody.bySource.ghb, "number");

      const listedContacts = await callContactsTool(adminKey.token, "list_contacts", deps);
      assert.equal(listedContacts.isError, false);
      assert.equal(Array.isArray((listedContacts.body as { contacts?: unknown[] }).contacts), true);
      const counted = await callContactsTool(adminKey.token, "count_contacts", deps);
      assert.equal(counted.isError, false);
      assert.equal(typeof (counted.body as { total?: number }).total, "number");

      const reader = await createApiKey({ userId, name: "reader", scopes: ["read"] }, deps);
      for (const kind of ["admin-contacts", "admin-contacts-count"] as const) {
        const denied = await handleV1Action(
          new Request(`https://dev.githubbounties.xyz/api/v1/admin/contacts${kind === "admin-contacts-count" ? "/count" : ""}`, {
            headers: { authorization: `Bearer ${reader.token}` },
          }),
          { kind },
          deps,
        );
        assert.equal(denied.status, 403);
        const body = (await denied.json()) as { error: { code: string } };
        assert.equal(body.error.code, "forbidden_scope");
      }
      for (const name of ["list_contacts", "count_contacts"] as const) {
        const denied = await callContactsTool(reader.token, name, deps);
        assert.equal(denied.isError, true);
        assert.equal((denied.body as { error: { code: string } }).error.code, "forbidden_scope");
      }
    } finally {
      await closeRuntimeDb();
      await sql.end({ timeout: 5 });
    }
  });
});

async function callContactsTool(
  token: string,
  name: "list_contacts" | "count_contacts",
  deps: ReturnType<typeof createAccessDeps>,
): Promise<{ isError: boolean; body: unknown }> {
  const response = await handleMcpHttp(
    new Request("https://dev.githubbounties.xyz/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: {} },
      }),
    }),
    deps,
  );
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  const text = payload.result?.content?.[0]?.text ?? "";
  return {
    isError: payload.result?.isError === true,
    body: text ? JSON.parse(text) : null,
  };
}
