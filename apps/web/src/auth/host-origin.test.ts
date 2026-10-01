import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import proxy from "../proxy";
import { allowlistedAuthOrigin, allowlistedCallbackUrl, prepareAuthRequest } from "./host-origin";
import { handleAuthRequest, performAuthAction } from "./index";

const PUBLIC_ORIGIN = "https://dev.githubbounties.xyz";
const ADMIN_ORIGIN = "https://admin-dev.githubbounties.xyz";
const PROD_ADMIN_ORIGIN = "https://admin.githubbounties.xyz";

async function withAuthEnv(run: () => Promise<void>) {
  const keys = ["PUBLIC_BASE_URL", "AUTH_URL", "NEXTAUTH_URL"] as const;
  const previous = new Map<string, string | undefined>();
  for (const key of keys) previous.set(key, process.env[key]);
  try {
    process.env.AUTH_URL = PUBLIC_ORIGIN;
    delete process.env.NEXTAUTH_URL;
    delete process.env.PUBLIC_BASE_URL;
    await run();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function authHeaders(host: string): Headers {
  return new Headers({
    host,
    "x-forwarded-host": host,
    "x-forwarded-proto": "https",
  });
}

async function proxyResponse(pathname: string, host: string): Promise<Response> {
  const request = new NextRequest(`http://0.0.0.0:8080${pathname}`, {
    headers: authHeaders(host),
  });
  return proxy(request, undefined as never);
}

function setCookieHeaders(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieValue(response: Response, namePart: string): string | undefined {
  const header = setCookieHeaders(response).find((item) => item.toLowerCase().includes(namePart));
  if (!header) return undefined;
  const pair = header.split(";")[0] ?? "";
  return decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
}

function assertHostOnly(response: Response) {
  const cookies = setCookieHeaders(response);
  assert.ok(cookies.length > 0);
  for (const header of cookies) assert.doesNotMatch(header, /domain=/i, header);
}

function redirectUri(location: string): string {
  return new URL(location).searchParams.get("redirect_uri") ?? "";
}

describe("auth host allowlist", () => {
  it("uses the pinned admin origin and ignores a spoofed host", () => {
    const env = { AUTH_URL: PUBLIC_ORIGIN, PUBLIC_BASE_URL: PUBLIC_ORIGIN };
    assert.equal(allowlistedAuthOrigin("admin-dev.githubbounties.xyz", env), ADMIN_ORIGIN);
    assert.equal(allowlistedAuthOrigin("admin.githubbounties.xyz", env), PROD_ADMIN_ORIGIN);
    assert.equal(allowlistedAuthOrigin("dev.githubbounties.xyz", env), PUBLIC_ORIGIN);
    assert.equal(allowlistedAuthOrigin("evil.example", env), PUBLIC_ORIGIN);
    assert.equal(allowlistedAuthOrigin("admin-dev.githubbounties.xyz.evil.example", env), PUBLIC_ORIGIN);
    assert.equal(allowlistedAuthOrigin("https://evil.example", env), PUBLIC_ORIGIN);
    assert.equal(
      allowlistedCallbackUrl("/admin", ADMIN_ORIGIN, env),
      `${ADMIN_ORIGIN}/admin`,
    );
    assert.equal(allowlistedCallbackUrl("https://evil.example/phish", ADMIN_ORIGIN, env), ADMIN_ORIGIN);
    assert.equal(
      allowlistedCallbackUrl(`${ADMIN_ORIGIN}/admin`, ADMIN_ORIGIN, env),
      `${ADMIN_ORIGIN}/admin`,
    );
  });

  it("rewrites the Auth.js request URL and leaves a spoofed host on the public origin", () => {
    const env = { AUTH_URL: PUBLIC_ORIGIN };
    const admin = prepareAuthRequest(
      new Request("http://0.0.0.0:8080/api/auth/signin/google", { headers: authHeaders("admin-dev.githubbounties.xyz") }),
      env,
    );
    assert.equal(admin.url, `${ADMIN_ORIGIN}/api/auth/signin/google`);

    const spoofed = prepareAuthRequest(
      new Request("http://0.0.0.0:8080/api/auth/signin/google", {
        headers: new Headers({
          host: "evil.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
        }),
      }),
      env,
    );
    assert.equal(spoofed.url, `${PUBLIC_ORIGIN}/api/auth/signin/google`);
    assert.doesNotMatch(spoofed.url, /evil\.example/);
  });

  it("redirects unsigned / and /admin on admin-dev to that host's sign-in", async () => {
    await withAuthEnv(async () => {
      for (const pathname of ["/", "/admin"]) {
        const response = await proxyResponse(pathname, "admin-dev.githubbounties.xyz");
        assert.equal(response.status, 307, pathname);
        assert.equal(
          response.headers.get("location"),
          `${ADMIN_ORIGIN}/signin?callbackUrl=%2Fadmin`,
          pathname,
        );
      }
    });
  });

  it("ignores a spoofed Host and X-Forwarded-Host", async () => {
    await withAuthEnv(async () => {
      const settings = await proxyResponse("/settings", "evil.example");
      assert.equal(settings.status, 307);
      assert.equal(settings.headers.get("location"), `${PUBLIC_ORIGIN}/signin?callbackUrl=%2Fsettings`);
      assert.doesNotMatch(settings.headers.get("location") ?? "", /evil\.example/);

      const admin = await proxyResponse("/admin", "evil.example");
      assert.equal(admin.status, 404);
      assert.equal(admin.headers.get("location"), null);

      const lookalike = await proxyResponse("/admin", "admin-dev.githubbounties.xyz.evil.example");
      assert.equal(lookalike.status, 404);
      assert.equal(lookalike.headers.get("location"), null);
    });
  });

  it("keeps the public host sign-in redirect on the public origin", async () => {
    await withAuthEnv(async () => {
      const response = await proxyResponse("/settings", "dev.githubbounties.xyz");
      assert.equal(response.status, 307);
      assert.equal(response.headers.get("location"), `${PUBLIC_ORIGIN}/signin?callbackUrl=%2Fsettings`);
    });
  });
});

describe("Google redirect_uri on the allowlisted host", () => {
  it("posts the server action to admin-dev and keeps PKCE, state, and the callback there", async () => {
    await withAuthEnv(async () => {
      const result = await performAuthAction(
        "signin/google",
        "/admin",
        authHeaders("admin-dev.githubbounties.xyz"),
      );
      assert.equal(redirectUri(result.redirect), `${ADMIN_ORIGIN}/api/auth/callback/google`);
      assert.doesNotMatch(result.redirect, /evil\.example|dev\.githubbounties\.xyz\/api\/auth\/callback/);
      const names = result.cookies.map((cookie) => cookie.name);
      assert.ok(names.some((name) => name.includes("pkce.code_verifier")));
      assert.ok(names.some((name) => name.endsWith(".state") || name.includes("authjs.state")));
      const callback = result.cookies.find((cookie) => cookie.name.includes("callback-url"));
      assert.equal(callback?.value, `${ADMIN_ORIGIN}/admin`);
      for (const cookie of result.cookies) assert.equal("domain" in cookie.options, false);
    });
  });

  it("keeps the public host redirect_uri on the public callback", async () => {
    await withAuthEnv(async () => {
      const result = await performAuthAction("signin/google", "/settings", authHeaders("dev.githubbounties.xyz"));
      assert.equal(redirectUri(result.redirect), `${PUBLIC_ORIGIN}/api/auth/callback/google`);
      const callback = result.cookies.find((cookie) => cookie.name.includes("callback-url"));
      assert.equal(callback?.value, `${PUBLIC_ORIGIN}/settings`);
    });
  });

  it("does not use a spoofed host as the redirect_uri", async () => {
    await withAuthEnv(async () => {
      const result = await performAuthAction("signin/google", "/settings", authHeaders("evil.example"));
      assert.equal(redirectUri(result.redirect), `${PUBLIC_ORIGIN}/api/auth/callback/google`);
      assert.doesNotMatch(result.redirect, /evil\.example/);
      const callback = result.cookies.find((cookie) => cookie.name.includes("callback-url"));
      assert.equal(callback?.value, `${PUBLIC_ORIGIN}/settings`);
    });
  });

  it("signs out on the admin host", async () => {
    await withAuthEnv(async () => {
      const result = await performAuthAction("signout", "/", authHeaders("admin-dev.githubbounties.xyz"));
      assert.equal(result.redirect, `${ADMIN_ORIGIN}/`);
      for (const cookie of result.cookies) assert.equal("domain" in cookie.options, false);
    });
  });

  it("sets a host-only csrf cookie on admin-dev and posts the callback there", async () => {
    await withAuthEnv(async () => {
      const csrf = await handleAuthRequest(
        new Request("http://0.0.0.0:8080/api/auth/csrf", { headers: authHeaders("admin-dev.githubbounties.xyz") }),
      );
      assert.equal(csrf.status, 200);
      assertHostOnly(csrf);
      const csrfCookie = cookieValue(csrf, "csrf-token");
      assert.ok(csrfCookie);
      const token = csrfCookie.split("|")[0] ?? "";
      const posted = await handleAuthRequest(
        new Request("http://0.0.0.0:8080/api/auth/signin/google", {
          method: "POST",
          headers: new Headers({
            ...Object.fromEntries(authHeaders("admin-dev.githubbounties.xyz")),
            cookie: setCookieHeaders(csrf)
              .map((header) => header.split(";")[0])
              .join("; "),
            "content-type": "application/x-www-form-urlencoded",
          }),
          body: new URLSearchParams({ csrfToken: token, callbackUrl: "/admin" }),
        }),
      );
      assert.equal(posted.status, 302);
      const location = posted.headers.get("location") ?? "";
      assert.equal(redirectUri(location), `${ADMIN_ORIGIN}/api/auth/callback/google`);
      assertHostOnly(posted);
      assert.ok(setCookieHeaders(posted).some((header) => header.includes("pkce.code_verifier")));
      assert.ok(setCookieHeaders(posted).some((header) => header.includes("authjs.state")));
      assert.equal(cookieValue(posted, "callback-url"), `${ADMIN_ORIGIN}/admin`);
    });
  });
});
