import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AccessDeps } from "../api/access/deps";
import { resultFromError, type ApiPrincipal } from "../api/access/handlers";
import { PublicApiError } from "../api/public/errors";
import { createBountiesMcpServer } from "../api/public/mcp";
import type { PublicReadApi } from "../api/public/service";
import { SearchValidationNotice } from "../components/search-validation-notice";
import { handleCountContacts, handleListContacts, handleListContactsArgs } from "./http";
import { planContactImport } from "./import";
import { normalizeContactEmail, normalizeImportedEmail, splitDisplayName } from "./normalize";
import { recordSignupContactSafe } from "./persist";
import { adminContactsOutOfRange, parseContactListQuery } from "./query";
import {
  bountyDetailId,
  isUtmHtmlNavigation,
  planUtmCookie,
  planUtmForNavigation,
  sanitizeLandingPath,
  sanitizeUtmValue,
  utmProxyStatus,
  UTM_MAX_AGE_SECONDS,
} from "./utm";
import {
  marketingSyncConfigured,
  pushContactToResend,
  syncMarketingContacts,
  unsubscribeFromResendEvent,
  verifyResendWebhookSignature,
} from "./resend";

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

function principal(scopes: Array<"read" | "write" | "money" | "admin">): ApiPrincipal {
  return {
    keyId: "key-1",
    userId: "user-1",
    name: "agent",
    env: "test",
    prefix: "gb_test",
    scopes: new Set(scopes),
    perTxCapUsdc: "1.000000",
    dailyCapUsdc: "1.000000",
  };
}

function deps(overrides: Partial<AccessDeps> = {}): AccessDeps {
  return {
    env: { ADMIN_EMAILS: "ada@example.com" },
    now: () => new Date("2026-10-03T00:00:00.000Z"),
    async loadAdminActor() {
      return { email: "ada@example.com", googleSub: "sub-ada" };
    },
    async insertRequest() {
      return "log-1";
    },
    async updateRequestStatus() {},
    async countRequests() {
      return 1;
    },
    ...overrides,
  } as AccessDeps;
}

function sign(secret: string, id: string, timestamp: string, payload: string): string {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const digest = createHmac("sha256", Buffer.from(raw, "base64"))
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return `v1,${digest}`;
}

describe("signup attribution cookie", () => {
  it("sanitizes values and keeps the first touch", () => {
    assert.equal(sanitizeUtmValue("<slot>"), "slot");
    assert.equal(sanitizeUtmValue("a".repeat(120))?.length, 100);
    assert.equal(sanitizeUtmValue("bad value!"), "badvalue");
    assert.equal(sanitizeUtmValue("@@@"), null);
    assert.equal(sanitizeLandingPath("/board"), "/board");
    assert.equal(sanitizeLandingPath("/"), "/");

    const params = new URLSearchParams(
      "utm_source=lb_email&utm_medium=email&utm_campaign=ghb_launch_oct2026&utm_content=<slot>",
    );
    const now = new Date("2026-10-03T00:00:00.000Z");
    const planned = planUtmCookie({
      existing: undefined,
      searchParams: params,
      pathname: "/",
      now,
      nodeEnv: "production",
    });
    assert.ok(planned);
    assert.equal(planned.name, "gb_utm");
    assert.equal(planned.options.httpOnly, true);
    assert.equal(planned.options.sameSite, "lax");
    assert.equal(planned.options.secure, true);
    assert.equal(planned.options.path, "/");
    assert.equal(planned.options.maxAge, UTM_MAX_AGE_SECONDS);
    const body = JSON.parse(planned.value) as {
      source: string;
      medium: string;
      campaign: string;
      content: string;
      term: null;
      path: string;
      ts: string;
    };
    assert.equal(body.source, "lb_email");
    assert.equal(body.medium, "email");
    assert.equal(body.campaign, "ghb_launch_oct2026");
    assert.equal(body.content, "slot");
    assert.equal(body.term, null);
    assert.equal(body.path, "/");
    assert.equal(body.ts, now.toISOString());

    assert.equal(
      planUtmCookie({
        existing: planned.value,
        searchParams: new URLSearchParams("utm_campaign=later"),
        pathname: "/other",
        now,
        nodeEnv: "development",
      }),
      null,
    );
    assert.equal(
      planUtmCookie({
        existing: undefined,
        searchParams: new URLSearchParams("utm_source=@@@"),
        pathname: "/",
        now,
        nodeEnv: "development",
      }),
      null,
    );
    assert.equal(
      planUtmCookie({
        existing: undefined,
        searchParams: new URLSearchParams("utm_source=ok"),
        pathname: "/",
        now,
        nodeEnv: "test",
      })?.options.secure,
      false,
    );

    const replaced = planUtmCookie({
      existing: "not-json",
      searchParams: new URLSearchParams("utm_source=later"),
      pathname: "/board",
      now,
      nodeEnv: "development",
    });
    assert.equal(JSON.parse(replaced?.value ?? "{}").source, "later");
    assert.equal(
      planUtmCookie({
        existing: '{"source":"@@@"}',
        searchParams: new URLSearchParams("utm_campaign=real"),
        pathname: "/",
        now,
        nodeEnv: "development",
      })?.value.includes("real"),
      true,
    );
  });

  it("stamps gb_utm only on a successful public HTML navigation", () => {
    const params = new URLSearchParams("utm_source=lb_email&utm_campaign=launch");
    const now = new Date("2026-10-03T00:00:00.000Z");
    const bountyId = "20bb5c8a-fd55-4f67-bb03-635611ef588c";
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: "/", adminHost: false }), true);
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: `/bounties/${bountyId}`, adminHost: false }), true);
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: "/bounties/not-a-uuid", adminHost: false }), false);
    assert.equal(isUtmHtmlNavigation({ method: "POST", pathname: "/", adminHost: false }), false);
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: "/", adminHost: true }), false);
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: "/admin/contacts", adminHost: false }), false);
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: "/api/v1/me", adminHost: false }), false);
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: "/robots.txt", adminHost: false }), false);
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: "/sitemap.xml", adminHost: false }), false);
    assert.equal(isUtmHtmlNavigation({ method: "GET", pathname: "/missing", adminHost: false }), false);

    function planned(overrides: Partial<Parameters<typeof planUtmForNavigation>[0]>) {
      return planUtmForNavigation({
        method: "GET",
        pathname: "/",
        adminHost: false,
        status: 200,
        rewritten: false,
        existing: undefined,
        searchParams: params,
        now,
        nodeEnv: "test",
        ...overrides,
      });
    }
    assert.equal(JSON.parse(planned({})?.value ?? "{}").source, "lb_email");
    assert.equal(planned({ pathname: "/api/v1/bounties" }), null);
    assert.equal(planned({ pathname: "/robots.txt" }), null);
    assert.equal(planned({ pathname: "/sitemap.xml" }), null);
    assert.equal(planned({ pathname: "/admin" }), null);
    assert.equal(planned({ pathname: "/no-such-page" }), null);
    assert.equal(planned({ adminHost: true }), null);
    assert.equal(planned({ status: 404 }), null);
    assert.equal(planned({ status: 307 }), null);
    assert.equal(bountyDetailId(`/bounties/${bountyId}`), bountyId);
    assert.equal(bountyDetailId("/bounties/not-a-uuid"), null);
    assert.equal(
      utmProxyStatus({ pathname: `/bounties/${bountyId}`, proxyStatus: 200, bountyExists: false }),
      404,
    );
    assert.equal(
      utmProxyStatus({ pathname: `/bounties/${bountyId}`, proxyStatus: 200, bountyExists: true }),
      200,
    );
    assert.equal(utmProxyStatus({ pathname: "/", proxyStatus: 200, bountyExists: false }), 200);
    assert.equal(JSON.parse(planned({ pathname: `/bounties/${bountyId}` })?.value ?? "{}").source, "lb_email");
    assert.equal(
      planned({
        pathname: `/bounties/${bountyId}`,
        status: utmProxyStatus({ pathname: `/bounties/${bountyId}`, proxyStatus: 200, bountyExists: false }),
      }),
      null,
    );
    assert.equal(planned({ rewritten: true }), null);
    assert.equal(planned({ method: "POST" }), null);
    assert.equal(planned({ existing: "%%%" })?.value.includes("lb_email"), true);
    const proxy = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../proxy.ts"), "utf8");
    assert.match(proxy, /planUtmForNavigation/);
    assert.match(proxy, /publicBountyExists/);
    assert.match(proxy, /utmProxyStatus/);
  });
});

describe("admin contacts page range", () => {
  it("treats a later empty page and an offset past the cap as out of range", () => {
    assert.equal(adminContactsOutOfRange(1, 0, 0), false);
    assert.equal(adminContactsOutOfRange(1, 0, 3), false);
    assert.equal(adminContactsOutOfRange(2, 50, 0), true);
    assert.equal(adminContactsOutOfRange(2002, 100_050, 0), true);
    assert.equal(adminContactsOutOfRange(2, 50, 4), false);
  });
});

describe("marketing contact normalization", () => {
  it("lowercases and trims, and drops GitHub noreply on sign-up", () => {
    assert.equal(normalizeContactEmail("  Ada@Example.com "), "ada@example.com");
    assert.equal(normalizeContactEmail("not-an-email"), null);
    assert.equal(normalizeContactEmail("  "), null);
    assert.equal(normalizeContactEmail("123+ada@users.noreply.github.com"), null);
    assert.equal(normalizeImportedEmail("123+ada@users.noreply.github.com"), "123+ada@users.noreply.github.com");
    assert.deepEqual(splitDisplayName("Ada Lovelace"), { firstName: "Ada", lastName: "Lovelace" });
    assert.deepEqual(splitDisplayName("Ada"), { firstName: "Ada", lastName: null });
  });
});

describe("marketing contact import plan", () => {
  it("lets the suppressed row win for the same email", () => {
    const master = [
      "email,first_name,last_name,github_username,source,lb1_status,contact_type",
      "Ada@Example.com,Ada,Lovelace,ada,lb1,active,hunter",
      "grace@example.com,Grace,Hopper,grace,lb1,active,hunter",
    ].join("\n");
    const suppressed = [
      "email,first_name,last_name,github_username,source,lb1_status,contact_type,suppression_reason",
      "ada@example.com,Ada,Lovelace,ada,lb1,active,hunter,bounce",
    ].join("\n");
    const planned = planContactImport(master, suppressed);
    const ada = planned.find((row) => row.email === "ada@example.com");
    const grace = planned.find((row) => row.email === "grace@example.com");
    assert.equal(planned.length, 2);
    assert.equal(ada?.subscribed, false);
    assert.equal(grace?.subscribed, true);
  });
});

describe("Resend marketing sync", () => {
  it("verifies a Svix signature and rejects a bad or stale one", () => {
    const secret = `whsec_${Buffer.from("test-webhook-secret-bytes").toString("base64")}`;
    const payload = JSON.stringify({ type: "contact.updated", data: { email: "ada@example.com", unsubscribed: true } });
    const now = new Date("2026-10-03T12:00:00.000Z");
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const signature = sign(secret, "msg_1", timestamp, payload);
    assert.equal(
      verifyResendWebhookSignature({ payload, id: "msg_1", timestamp, signature, secret, now }),
      true,
    );
    assert.equal(
      verifyResendWebhookSignature({ payload, id: "msg_1", timestamp, signature: "v1,bm8=", secret, now }),
      false,
    );
    assert.equal(
      verifyResendWebhookSignature({
        payload,
        id: "msg_1",
        timestamp: String(Math.floor(now.getTime() / 1000) - 3600),
        signature,
        secret,
        now,
      }),
      false,
    );
  });

  it("turns unsubscribe events into a local unsubscribe and ignores a subscribed update", () => {
    assert.deepEqual(
      unsubscribeFromResendEvent({
        type: "contact.updated",
        data: { email: "Ada@Example.com", unsubscribed: true, id: "re_1", audience_id: "aud" },
      }),
      { email: "ada@example.com", resendId: "re_1", audienceId: "aud" },
    );
    assert.equal(
      unsubscribeFromResendEvent({
        type: "contact.updated",
        data: { email: "ada@example.com", unsubscribed: false },
      }),
      null,
    );
    assert.equal(
      unsubscribeFromResendEvent({
        type: "contact.unsubscribed",
        data: { email: "ada@example.com" },
      })?.email,
      "ada@example.com",
    );
  });

  it("is a no-op when RESEND_AUDIENCE_ID is unset", async () => {
    assert.equal(marketingSyncConfigured({ RESEND_API_KEY: "re_test" }), false);
    let calls = 0;
    const http = async () => {
      calls += 1;
      throw new Error("should not call Resend");
    };
    const pushed = await pushContactToResend(
      {
        id: "c1",
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        githubUsername: null,
        source: "ghb",
        subscribed: true,
        unsubscribedAt: null,
        resendContactId: null,
        resendSyncedAt: null,
        updatedAt: new Date(),
      },
      { RESEND_API_KEY: "re_test" },
      http,
    );
    assert.deepEqual(pushed, { ok: true, id: null });
    const synced = await syncMarketingContacts({} as never, {
      env: { RESEND_API_KEY: "re_test" },
      http,
    });
    assert.deepEqual(synced, { configured: false, pushed: 0, pushFailed: 0, pullUnsubscribed: 0 });
    assert.equal(calls, 0);
  });
});

describe("contact search control characters", () => {
  function assertRejected(search: string) {
    assert.throws(
      () => parseContactListQuery({ search }),
      (err: unknown) => {
        assert.ok(err instanceof PublicApiError);
        assert.equal(err.code, "validation_failed");
        assert.equal(err.status, 400);
        assert.equal(err.message, "Search cannot include control characters.");
        assert.equal(err.details, null);
        return true;
      },
    );
  }

  it("rejects NUL and the other C0 and DEL controls before a query", () => {
    assertRejected("\u0000");
    assertRejected("ab\u0000cd");
    assertRejected("\u0001");
    assertRejected("ada\u001F");
    assertRejected("ada\u007F");
    assertRejected("\ninside");
    const parsed = parseContactListQuery({ search: "  ada@example.com  " });
    assert.equal(parsed.search, "ada@example.com");
  });

  it("returns 400 validation_failed on REST for search and q", async () => {
    for (const href of [
      "https://admin.example/api/v1/admin/contacts?search=%00",
      "https://admin.example/api/v1/admin/contacts?search=ab%00cd",
      "https://admin.example/api/v1/admin/contacts?q=%00",
      "https://admin.example/api/v1/admin/contacts?q=%7F",
    ]) {
      await assert.rejects(
        () => handleListContacts(principal(["admin"]), new URL(href), deps()),
        (err: unknown) => {
          assert.ok(err instanceof PublicApiError);
          const result = resultFromError(err);
          assert.equal(result.status, 400);
          const body = result.body as { error: { code: string; message: string; details: unknown } };
          assert.equal(body.error.code, "validation_failed");
          assert.equal(body.error.message, "Search cannot include control characters.");
          assert.equal(body.error.details, null);
          return true;
        },
      );
    }
    await assert.rejects(
      () => handleListContactsArgs(principal(["admin"]), { search: "\u0000" }, deps()),
      (err: unknown) => err instanceof PublicApiError && err.code === "validation_failed" && err.status === 400,
    );
  });

  it("returns validation_failed from MCP list_contacts and does not query", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createBountiesMcpServer(catalogApi, {
      principal: principal(["admin"]),
      deps: deps(),
      ip: "127.0.0.1",
      origin: "https://dev.githubbounties.xyz",
    });
    const client = new Client({ name: "contacts", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      for (const search of ["\u0000", "ab\u0000cd", "\u007F"]) {
        const denied = await client.callTool({ name: "list_contacts", arguments: { search } });
        assert.equal(denied.isError, true);
        const content = denied.content as Array<{ text?: string }>;
        const body = JSON.parse(content[0]?.text ?? "") as { error: { code: string; message: string } };
        assert.equal(body.error.code, "validation_failed");
        assert.equal(body.error.message, "Search cannot include control characters.");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("shows the validation message on the admin contacts page", () => {
    let message: string | null = null;
    try {
      parseContactListQuery({ search: "\u0000" });
    } catch (err) {
      assert.ok(err instanceof PublicApiError);
      message = err.message;
    }
    const html = renderToStaticMarkup(createElement(SearchValidationNotice, { message }));
    assert.match(html, /role="alert"/);
    assert.match(html, /Search cannot include control characters/);
    assert.equal(renderToStaticMarkup(createElement(SearchValidationNotice, { message: null })), "");
    const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/admin/contacts/page.tsx"), "utf8");
    const board = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/board/page.tsx"), "utf8");
    const admin = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/admin/page.tsx"), "utf8");
    assert.match(page, /SearchValidationNotice/);
    assert.match(page, /err instanceof PublicApiError/);
    assert.match(page, /error = err\.message/);
    assert.match(board, /SearchValidationNotice/);
    assert.match(admin, /SearchValidationNotice/);
    assert.match(admin, /containsControlChars/);
  });
});

describe("admin contact access", () => {
  it("returns forbidden_scope for a key without the admin scope", async () => {
    await assert.rejects(
      () => handleListContacts(principal(["read"]), new URL("https://admin.example/api/v1/admin/contacts"), deps()),
      (err: unknown) => {
        assert.ok(err instanceof PublicApiError);
        const result = resultFromError(err);
        assert.equal(result.status, 403);
        assert.equal((result.body as { error: { code: string } }).error.code, "forbidden_scope");
        return true;
      },
    );
    await assert.rejects(
      () => handleCountContacts(principal(["read", "write"]), deps()),
      (err: unknown) => err instanceof PublicApiError && err.code === "forbidden_scope" && err.status === 403,
    );
  });

  it("returns forbidden_scope when the key owner is not an admin", async () => {
    await assert.rejects(
      () =>
        handleCountContacts(
          principal(["admin"]),
          deps({
            async loadAdminActor() {
              return { email: "other@example.com", googleSub: "sub-other" };
            },
          }),
        ),
      (err: unknown) => err instanceof PublicApiError && err.code === "forbidden_scope" && err.status === 403,
    );
  });

  it("rejects list_contacts and count_contacts on MCP without the admin scope", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createBountiesMcpServer(catalogApi, {
      principal: principal(["read"]),
      deps: deps(),
      ip: "127.0.0.1",
      origin: "https://dev.githubbounties.xyz",
    });
    const client = new Client({ name: "contacts", version: "0.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      for (const name of ["list_contacts", "count_contacts"]) {
        const denied = await client.callTool({ name, arguments: {} });
        assert.equal(denied.isError, true);
        const content = denied.content as Array<{ text?: string }>;
        const body = JSON.parse(content[0]?.text ?? "") as { error: { code: string } };
        assert.equal(body.error.code, "forbidden_scope");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});

describe("sign-up contact hook", () => {
  it("logs and continues when the contact write fails", async () => {
    const db = {
      select() {
        throw new Error("db down");
      },
    };
    await recordSignupContactSafe(db as never, {
      id: "user-1",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
    });
  });
});
