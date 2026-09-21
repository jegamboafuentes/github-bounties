import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clipIssueBody,
  escapeHtml,
  isSafeHref,
  isSafeImgSrc,
  looksLegacyClippedBody,
  renderSafeIssueHtml,
} from "./markdown";

describe("issue markdown", () => {
  it("escapes raw HTML and drops javascript: links", () => {
    const html = renderSafeIssueHtml(
      `<script>alert(1)</script>\n[click me](javascript:alert(1))\n[ok](https://github.com/octo/hello)`,
    );
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /&lt;script&gt;/);
    assert.equal(html.includes("javascript:"), false);
    assert.match(html, /href="https:\/\/github.com\/octo\/hello"/);
    assert.match(html, /rel="noreferrer noopener"/);
  });

  it("renders headings, lists, fenced code, and https images only", () => {
    const html = renderSafeIssueHtml(
      [
        "# Title",
        "",
        "- one",
        "- two",
        "",
        "```ts",
        "const n = 1;",
        "```",
        "",
        "![x](https://avatars.githubusercontent.com/u/1)",
        "![bad](http://example.com/x.png)",
        "![data](data:image/png;base64,aaaa)",
      ].join("\n"),
    );
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(html, /<pre><code class="language-ts">/);
    assert.match(html, /src="https:\/\/avatars.githubusercontent.com\/u\/1"/);
    assert.equal(html.includes("http://example.com/x.png"), false);
    assert.equal(html.includes("data:image"), false);
  });

  it("clips at GitHub's issue body cap and detects legacy 4k snapshots", () => {
    const long = "a".repeat(70_000);
    const clipped = clipIssueBody(long);
    assert.equal(clipped?.length, 65_536);
    assert.equal(clipped?.endsWith("…"), true);
    assert.equal(looksLegacyClippedBody(`${"b".repeat(3999)}…`), true);
    assert.equal(looksLegacyClippedBody("short…"), false);
  });

  it("only allows http(s)/mailto hrefs", () => {
    assert.equal(isSafeHref("https://example.com"), true);
    assert.equal(isSafeHref("http://example.com"), true);
    assert.equal(isSafeHref("mailto:a@b.c"), true);
    assert.equal(isSafeHref("javascript:alert(1)"), false);
    assert.equal(isSafeImgSrc("https://example.com/a.png"), true);
    assert.equal(isSafeImgSrc("http://example.com/a.png"), false);
    assert.equal(escapeHtml("<x>"), "&lt;x&gt;");
  });
});
