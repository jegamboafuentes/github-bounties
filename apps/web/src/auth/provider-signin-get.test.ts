import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProviderSignInGet, providerSignInGetResponse } from "./provider-signin-get";

async function loadRoute() {
  return import("../app/api/auth/[...nextauth]/route.ts");
}

describe("GET /api/auth/signin/<provider>", () => {
  it("redirects a provider GET to /signin and does not log", () => {
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const response = providerSignInGetResponse(
        new URL("https://dev.githubbounties.xyz/api/auth/signin/google"),
      );
      assert.ok(response);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "https://dev.githubbounties.xyz/signin");
      assert.equal(errors.length, 0);
    } finally {
      console.error = original;
    }
  });

  it("treats any provider segment the same, including a trailing slash", () => {
    const response = providerSignInGetResponse(
      new URL("http://localhost:3000/api/auth/signin/google/"),
    );
    assert.ok(response);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "http://localhost:3000/signin");
    assert.equal(isProviderSignInGet("/api/auth/signin/google"), true);
  });

  it("route GET redirects before Auth.js and does not log", async () => {
    const { GET } = await loadRoute();
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const response = await GET(
        new Request("https://dev.githubbounties.xyz/api/auth/signin/google") as never,
      );
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "https://dev.githubbounties.xyz/signin");
      assert.equal(errors.length, 0);
    } finally {
      console.error = original;
    }
  });

  it("leaves POST, callbacks, and sign-out on Auth.js", async () => {
    const { GET, POST } = await loadRoute();
    const original = console.error;
    console.error = () => {};
    try {
      const post = await POST(
        new Request("https://dev.githubbounties.xyz/api/auth/signin/google", {
          method: "POST",
        }) as never,
      );
      assert.equal(post.status, 302);
      assert.match(post.headers.get("location") ?? "", /\/signin\?error=MissingCSRF/);

      const callback = await GET(
        new Request("https://dev.githubbounties.xyz/api/auth/callback/google") as never,
      );
      assert.notEqual(callback.status, 303);
      assert.notEqual(callback.headers.get("location"), "https://dev.githubbounties.xyz/signin");

      const signout = await GET(new Request("https://dev.githubbounties.xyz/api/auth/signout") as never);
      assert.notEqual(signout.headers.get("location"), "https://dev.githubbounties.xyz/signin");
    } finally {
      console.error = original;
    }
  });

  it("leaves the real Auth.js GET routes to the handler", () => {
    const passthrough = [
      "/api/auth/signin",
      "/api/auth/callback/google",
      "/api/auth/signout",
      "/api/auth/session",
      "/api/auth/csrf",
      "/api/auth/providers",
      "/api/auth/signin/google/callback",
      "/signin",
    ];
    for (const pathname of passthrough) {
      assert.equal(isProviderSignInGet(pathname), false, pathname);
      assert.equal(
        providerSignInGetResponse(new URL(`https://githubbounties.xyz${pathname}`)),
        null,
        pathname,
      );
    }
  });
});
