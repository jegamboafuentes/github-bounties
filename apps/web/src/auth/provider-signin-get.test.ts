import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProviderSignInGet, providerSignInGetResponse } from "./provider-signin-get";

const EMPTY_ENV = {};

function assertSafeLocation(location: string | null) {
  assert.ok(location);
  assert.doesNotMatch(location, /0\.0\.0\.0|localhost|127\.0\.0\.1|evil\.example/);
}

async function loadRoute() {
  return import("../app/api/auth/[...nextauth]/route.ts");
}

async function withSiteEnv(
  env: { PUBLIC_BASE_URL?: string; AUTH_URL?: string },
  run: () => Promise<void>,
) {
  const keys = ["PUBLIC_BASE_URL", "AUTH_URL"] as const;
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

describe("GET /api/auth/signin/<provider>", () => {
  it("redirects a provider GET to the configured public origin and does not log", () => {
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      const response = providerSignInGetResponse(
        new URL("http://0.0.0.0:8080/api/auth/signin/google"),
        { env: { PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" } },
      );
      assert.ok(response);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get("location"), "https://dev.githubbounties.xyz/signin");
      assertSafeLocation(response.headers.get("location"));
      assert.equal(errors.length, 0);
    } finally {
      console.error = original;
    }
  });

  it("treats any provider segment the same, including a trailing slash", () => {
    const response = providerSignInGetResponse(
      new URL("http://localhost:3000/api/auth/signin/google/"),
      { env: { AUTH_URL: "https://githubbounties.xyz" } },
    );
    assert.ok(response);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://githubbounties.xyz/signin");
    assertSafeLocation(response.headers.get("location"));
    assert.equal(isProviderSignInGet("/api/auth/signin/google"), true);
  });

  it("uses AUTH_URL and ignores the container bind address", () => {
    const response = providerSignInGetResponse(
      new URL("http://0.0.0.0:8080/api/auth/signin/google"),
      { env: { AUTH_URL: "https://dev.githubbounties.xyz" } },
    );
    assert.ok(response);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://dev.githubbounties.xyz/signin");
    assertSafeLocation(response.headers.get("location"));
  });

  it("falls back to a relative Location when no public origin is configured", () => {
    const response = providerSignInGetResponse(
      new URL("http://0.0.0.0:8080/api/auth/signin/google"),
      { env: EMPTY_ENV },
    );
    assert.ok(response);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/signin");
    assertSafeLocation(response.headers.get("location"));
  });

  it("does not redirect to a loopback AUTH_URL", () => {
    for (const AUTH_URL of ["http://localhost:3000", "http://127.0.0.1:8080", "http://0.0.0.0:8080"]) {
      const response = providerSignInGetResponse(
        new URL("http://0.0.0.0:8080/api/auth/signin/google"),
        { env: { AUTH_URL } },
      );
      assert.ok(response);
      assert.equal(response.headers.get("location"), "/signin");
      assertSafeLocation(response.headers.get("location"));
    }
  });

  it("route GET ignores spoofed forwarded host and does not log", async () => {
    const { GET } = await loadRoute();
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      await withSiteEnv({}, async () => {
        const response = await GET(
          new Request("http://0.0.0.0:8080/api/auth/signin/google", {
            headers: {
              "x-forwarded-host": "evil.example",
              "x-forwarded-proto": "https",
              host: "0.0.0.0:8080",
            },
          }) as never,
        );
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), "/signin");
        assertSafeLocation(response.headers.get("location"));
        assert.equal(errors.length, 0);
      });

      await withSiteEnv({ AUTH_URL: "https://dev.githubbounties.xyz" }, async () => {
        const response = await GET(
          new Request("http://0.0.0.0:8080/api/auth/signin/google", {
            headers: {
              "x-forwarded-host": "evil.example",
              "x-forwarded-proto": "https",
            },
          }) as never,
        );
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), "https://dev.githubbounties.xyz/signin");
        assertSafeLocation(response.headers.get("location"));
      });
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

  it("keeps a relative callbackUrl and drops open redirects", () => {
    const kept = providerSignInGetResponse(
      new URL("http://0.0.0.0:8080/api/auth/signin/google?callbackUrl=/settings"),
      { env: { PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" } },
    );
    assert.ok(kept);
    assert.equal(kept.status, 303);
    assert.equal(
      kept.headers.get("location"),
      "https://dev.githubbounties.xyz/signin?callbackUrl=%2Fsettings",
    );

    const nested = providerSignInGetResponse(
      new URL("https://githubbounties.xyz/api/auth/signin/google?callbackUrl=/bounties/abc%3Ftab%3D1"),
      { env: { AUTH_URL: "https://githubbounties.xyz" } },
    );
    assert.equal(
      nested?.headers.get("location"),
      "https://githubbounties.xyz/signin?callbackUrl=%2Fbounties%2Fabc%3Ftab%3D1",
    );

    const relativeBase = providerSignInGetResponse(
      new URL("http://0.0.0.0:8080/api/auth/signin/google?callbackUrl=/mcp"),
      { env: EMPTY_ENV },
    );
    assert.equal(relativeBase?.headers.get("location"), "/signin?callbackUrl=%2Fmcp");

    const attacks = [
      "https://evil.example/phish",
      "http://evil.example",
      "//evil.example",
      "//evil.example/signin",
      "/\\evil.example",
      "javascript:alert(1)",
      "https:evil",
    ];
    for (const callbackUrl of attacks) {
      const response = providerSignInGetResponse(
        new URL(
          `http://0.0.0.0:8080/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        ),
        { env: { PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" } },
      );
      assert.equal(response?.headers.get("location"), "https://dev.githubbounties.xyz/signin", callbackUrl);
      assert.doesNotMatch(response?.headers.get("location") ?? "", /evil|javascript/i, callbackUrl);
    }
  });

  it("normalizes an absolute same-origin callbackUrl to its path", () => {
    const same = providerSignInGetResponse(
      new URL(
        "http://0.0.0.0:8080/api/auth/signin/google?callbackUrl=" +
          encodeURIComponent("https://dev.githubbounties.xyz/admin?tab=1"),
      ),
      { env: { PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" } },
    );
    assert.equal(
      same?.headers.get("location"),
      "https://dev.githubbounties.xyz/signin?callbackUrl=%2Fadmin%3Ftab%3D1",
    );

    const admin = providerSignInGetResponse(
      new URL(
        "http://0.0.0.0:8080/api/auth/signin/google?callbackUrl=" +
          encodeURIComponent("https://admin-dev.githubbounties.xyz/admin"),
      ),
      {
        env: { AUTH_URL: "https://dev.githubbounties.xyz" },
        host: "admin-dev.githubbounties.xyz",
      },
    );
    assert.equal(
      admin?.headers.get("location"),
      "https://admin-dev.githubbounties.xyz/signin?callbackUrl=%2Fadmin",
    );
  });

  it("route GET carries a safe callbackUrl and ignores a spoofed host", async () => {
    const { GET } = await loadRoute();
    await withSiteEnv({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz" }, async () => {
      const kept = await GET(
        new Request("http://0.0.0.0:8080/api/auth/signin/google?callbackUrl=/settings", {
          headers: {
            "x-forwarded-host": "evil.example",
            "x-forwarded-proto": "https",
            host: "evil.example",
          },
        }) as never,
      );
      assert.equal(kept.status, 303);
      assert.equal(
        kept.headers.get("location"),
        "https://dev.githubbounties.xyz/signin?callbackUrl=%2Fsettings",
      );
      assertSafeLocation(kept.headers.get("location"));

      const attack = await GET(
        new Request(
          "http://0.0.0.0:8080/api/auth/signin/google?callbackUrl=https%3A%2F%2Fevil.example%2Fphish",
          {
            headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
          },
        ) as never,
      );
      assert.equal(attack.headers.get("location"), "https://dev.githubbounties.xyz/signin");
      assertSafeLocation(attack.headers.get("location"));
    });
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
        providerSignInGetResponse(new URL(`https://githubbounties.xyz${pathname}`), {
          env: EMPTY_ENV,
        }),
        null,
        pathname,
      );
    }
  });
});
