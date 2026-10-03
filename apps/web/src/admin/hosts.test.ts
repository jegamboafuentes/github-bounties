import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyHostRequest, isAdminConsoleHost } from "./hosts";

describe("admin hosts", () => {
  it("404s /admin on the public hosts and rewrites the admin hosts", () => {
    assert.equal(classifyHostRequest("dev.githubbounties.xyz", "/admin").action, "not_found");
    assert.equal(classifyHostRequest("githubbounties.xyz", "/api/v1/admin/settings").action, "not_found");
    assert.equal(classifyHostRequest("dev.githubbounties.xyz", "/board").action, "next");
    assert.equal(isAdminConsoleHost("admin-dev.githubbounties.xyz"), true);
    assert.equal(classifyHostRequest("admin-dev.githubbounties.xyz", "/").action, "rewrite");
    assert.equal(classifyHostRequest("admin.githubbounties.xyz", "/board").action, "not_found");
    assert.equal(classifyHostRequest("admin.githubbounties.xyz", "/signin").action, "next");
    assert.equal(classifyHostRequest("admin.githubbounties.xyz", "/api/auth/callback/google").action, "next");
    assert.equal(classifyHostRequest("admin-dev.githubbounties.xyz", "/robots.txt").action, "robots");
    const adminPage = classifyHostRequest("admin.githubbounties.xyz", "/admin");
    assert.equal(adminPage.action, "next");
    assert.equal(adminPage.robots, true);
    assert.equal(classifyHostRequest("localhost:3000", "/admin").action, "next");
    assert.equal(classifyHostRequest("admin-dev.githubbounties.xyz", "/").robots, true);
    assert.equal(classifyHostRequest("githubbounties.xyz", "/admin/contacts").action, "not_found");
    assert.equal(classifyHostRequest("admin.githubbounties.xyz", "/admin/contacts").action, "next");
    assert.equal(classifyHostRequest("dev.githubbounties.xyz", "/api/webhooks/resend").action, "next");
    assert.equal(classifyHostRequest("dev.githubbounties.xyz", "/api/jobs/sync-contacts").action, "next");
  });
});
