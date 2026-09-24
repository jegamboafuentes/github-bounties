import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FunderAvatarStack } from "../components/funder-avatar-stack";
import {
  BOARD_FUNDER_AVATAR_LIMIT,
  funderStackAriaLabel,
  groupBoardFunderRows,
  resolveFunderAvatarUrl,
  summarizeRankedFunders,
  type RankedFunderRow,
} from "./funders";

const BOUNTY = "00000000-0000-4000-8000-0000000000b0";

function row(partial: Partial<RankedFunderRow> & Pick<RankedFunderRow, "userId" | "rn">): RankedFunderRow {
  return {
    bountyId: BOUNTY,
    displayName: partial.displayName ?? `Funder ${partial.rn}`,
    avatarUrl: partial.avatarUrl ?? null,
    githubAvatarUrl: partial.githubAvatarUrl ?? null,
    githubLogin: partial.githubLogin ?? null,
    funderCount: partial.funderCount ?? 1,
    ...partial,
  };
}

describe("board funder avatars", () => {
  it("prefers the Google https picture, then GitHub, and drops non-https", () => {
    assert.equal(
      resolveFunderAvatarUrl({
        avatarUrl: "https://lh3.googleusercontent.com/a/ada",
        githubLogin: "ada",
        githubAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      }),
      "https://lh3.googleusercontent.com/a/ada",
    );
    assert.equal(
      resolveFunderAvatarUrl({
        avatarUrl: "http://evil.example/a.png",
        githubAvatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
        githubLogin: "bob",
      }),
      "https://avatars.githubusercontent.com/u/2?v=4",
    );
    assert.equal(
      resolveFunderAvatarUrl({
        avatarUrl: "javascript:alert(1)",
        githubLogin: "carol",
        size: 48,
      }),
      "https://avatars.githubusercontent.com/carol?s=48",
    );
    assert.equal(resolveFunderAvatarUrl({ avatarUrl: null, githubLogin: "  " }), null);
  });

  it("keeps one face for a single funder and nothing when nobody funded", () => {
    const one = summarizeRankedFunders([
      row({
        userId: "u1",
        rn: 1,
        displayName: "Alice",
        avatarUrl: "https://lh3.googleusercontent.com/a/alice",
        funderCount: 1,
      }),
    ]);
    assert.equal(one.funderCount, 1);
    assert.deepEqual(
      one.funders.map((funder) => funder.displayName),
      ["Alice"],
    );
    assert.equal(one.funders[0]?.avatarUrl, "https://lh3.googleusercontent.com/a/alice");
    assert.deepEqual(summarizeRankedFunders([]), { funders: [], funderCount: 0 });
  });

  it("orders most recent first, dedupes a repeat funder, and caps at 5 with the full count", () => {
    const summary = summarizeRankedFunders([
      row({ userId: "late", rn: 1, displayName: "Eve", funderCount: 6 }),
      row({ userId: "late", rn: 1, displayName: "Eve", funderCount: 6 }),
      row({ userId: "d", rn: 4, displayName: "Dave", funderCount: 6 }),
      row({ userId: "b", rn: 2, displayName: "Bob", funderCount: 6 }),
      row({ userId: "c", rn: 3, displayName: "Carol", funderCount: 6 }),
      row({ userId: "a", rn: 5, displayName: "Alice", funderCount: 6 }),
      row({ userId: "hidden", rn: 6, displayName: "Zoe", funderCount: 6 }),
    ]);
    assert.equal(BOARD_FUNDER_AVATAR_LIMIT, 5);
    assert.equal(summary.funderCount, 6);
    assert.deepEqual(
      summary.funders.map((funder) => funder.displayName),
      ["Eve", "Bob", "Carol", "Dave", "Alice"],
    );
  });

  it("groups rows per bounty", () => {
    const grouped = groupBoardFunderRows([
      row({ bountyId: "b1", userId: "u1", rn: 1, displayName: "Ada", funderCount: 1 }),
      row({ bountyId: "b2", userId: "u2", rn: 1, displayName: "Grace", funderCount: 1 }),
    ]);
    assert.equal(grouped.get("b1")?.funders[0]?.displayName, "Ada");
    assert.equal(grouped.get("b2")?.funders[0]?.displayName, "Grace");
    assert.equal(grouped.get("b1")?.funderCount, 1);
  });

  it("builds an accessible name for one face, several faces, and overflow", () => {
    assert.equal(funderStackAriaLabel([{ displayName: "Alice" }], 1), "Funded by Alice");
    assert.equal(
      funderStackAriaLabel([{ displayName: "Alice" }, { displayName: "Bob" }], 2),
      "Funded by Alice and Bob",
    );
    assert.equal(
      funderStackAriaLabel(
        [{ displayName: "Alice" }, { displayName: "Bob" }, { displayName: "Carol" }],
        3,
      ),
      "Funded by Alice, Bob, and Carol",
    );
    assert.equal(
      funderStackAriaLabel([{ displayName: "Alice" }, { displayName: "Bob" }], 5),
      "Funded by Alice, Bob, and 3 others",
    );
    assert.equal(
      funderStackAriaLabel(
        [
          { displayName: "Alice" },
          { displayName: "Bob" },
          { displayName: "Carol" },
          { displayName: "Dave" },
          { displayName: "Eve" },
        ],
        6,
      ),
      "Funded by Alice, Bob, Carol, Dave, Eve, and 1 other",
    );
  });
});

describe("FunderAvatarStack", () => {
  const face = (userId: string, displayName: string, avatarUrl: string | null) => ({
    userId,
    displayName,
    avatarUrl,
  });

  it("renders one picture for a single funder and nothing when unfunded", () => {
    const one = renderToStaticMarkup(
      createElement(FunderAvatarStack, {
        funders: [face("u1", "Alice", "https://lh3.googleusercontent.com/a/alice")],
        funderCount: 1,
      }),
    );
    assert.equal(one.match(/<img /g)?.length, 1);
    assert.match(one, /aria-label="Funded by Alice"/);
    assert.match(one, /title="Alice"/);
    assert.doesNotMatch(one, /\+[0-9]/);
    assert.equal(
      renderToStaticMarkup(
        createElement(FunderAvatarStack, { funders: [], funderCount: 0 }),
      ),
      "",
    );
  });

  it("renders five faces and a +N chip when more than five people funded", () => {
    const names = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank"];
    const html = renderToStaticMarkup(
      createElement(FunderAvatarStack, {
        funderCount: 6,
        funders: names.map((displayName, index) =>
          face(
            `u${index}`,
            displayName,
            index === 1 ? null : `https://lh3.googleusercontent.com/a/${displayName.toLowerCase()}`,
          ),
        ),
      }),
    );
    assert.equal(html.match(/<img /g)?.length, 4);
    assert.match(html, />B</);
    assert.match(html, />\+1</);
    assert.match(html, /aria-label="Funded by Alice, Bob, Carol, Dave, Eve, and 1 other"/);
    assert.match(html, /-ml-2/);
  });

  it("uses two initials when a funder has no picture", () => {
    const html = renderToStaticMarkup(
      createElement(FunderAvatarStack, {
        funderCount: 1,
        funders: [face("u1", "Ada Lovelace", null)],
      }),
    );
    assert.doesNotMatch(html, /<img /);
    assert.match(html, />AL</);
    assert.match(html, /title="Ada Lovelace"/);
  });
});
