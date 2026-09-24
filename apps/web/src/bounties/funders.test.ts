import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FunderAvatarStack } from "../components/funder-avatar-stack";
import { FunderContributionList } from "../components/funder-contributions";
import {
  BOARD_FUNDER_AVATAR_LIMIT,
  collapseContributionFunders,
  dedupeShownFunders,
  funderStackAriaLabel,
  resolveFunderAvatarUrl,
  type ContributionFunderRow,
} from "./funders";

const BOUNTY = "00000000-0000-4000-8000-0000000000b0";

function row(
  partial: Partial<ContributionFunderRow> & Pick<ContributionFunderRow, "userId" | "createdAt">,
): ContributionFunderRow {
  return {
    bountyId: BOUNTY,
    displayName: partial.displayName ?? "Funder",
    avatarUrl: partial.avatarUrl ?? null,
    githubAvatarUrl: partial.githubAvatarUrl ?? null,
    githubLogin: partial.githubLogin ?? null,
    ...partial,
  };
}

function at(seconds: number): Date {
  return new Date(Date.UTC(2026, 8, 1, 0, 0, seconds));
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
    const one = collapseContributionFunders([
      row({
        userId: "u1",
        createdAt: at(1),
        displayName: "Alice",
        avatarUrl: "https://lh3.googleusercontent.com/a/alice",
      }),
    ]).get(BOUNTY);
    assert.equal(one?.funderCount, 1);
    assert.deepEqual(
      one?.funders.map((funder) => funder.displayName),
      ["Alice"],
    );
    assert.equal(one?.funders[0]?.avatarUrl, "https://lh3.googleusercontent.com/a/alice");
    assert.equal(collapseContributionFunders([]).size, 0);
  });

  it("collapses a repeat top-up from the same user id to one face", () => {
    const summary = collapseContributionFunders([
      row({
        userId: "enrique",
        createdAt: at(1),
        displayName: "Enrique Gamboa",
        avatarUrl: "https://lh3.googleusercontent.com/a/enrique",
      }),
      row({
        userId: "enrique",
        createdAt: at(30),
        displayName: "Enrique Gamboa",
        avatarUrl: "https://lh3.googleusercontent.com/a/enrique",
      }),
    ]).get(BOUNTY);
    assert.equal(summary?.funderCount, 1);
    assert.deepEqual(
      summary?.funders.map((funder) => funder.userId),
      ["enrique"],
    );
  });

  it("keeps two faces when two user ids share a display name", () => {
    const summary = collapseContributionFunders([
      row({ userId: "lb", createdAt: at(1), displayName: "Enrique Gamboa" }),
      row({ userId: "mp", createdAt: at(30), displayName: "Enrique Gamboa" }),
    ]).get(BOUNTY);
    assert.equal(summary?.funderCount, 2);
    assert.deepEqual(
      summary?.funders.map((funder) => funder.userId),
      ["mp", "lb"],
    );
  });

  it("orders by each user's latest contribution and caps distinct funders at 5", () => {
    const summary = collapseContributionFunders([
      row({ userId: "eve", createdAt: at(1), displayName: "Eve" }),
      row({ userId: "eve", createdAt: at(50), displayName: "Eve" }),
      row({ userId: "dave", createdAt: at(40), displayName: "Dave" }),
      row({ userId: "bob", createdAt: at(20), displayName: "Bob" }),
      row({ userId: "carol", createdAt: at(30), displayName: "Carol" }),
      row({ userId: "alice", createdAt: at(10), displayName: "Alice" }),
      row({ userId: "zoe", createdAt: at(5), displayName: "Zoe" }),
    ]).get(BOUNTY);
    assert.equal(BOARD_FUNDER_AVATAR_LIMIT, 5);
    assert.equal(summary?.funderCount, 6);
    assert.deepEqual(
      summary?.funders.map((funder) => funder.displayName),
      ["Eve", "Dave", "Carol", "Bob", "Alice"],
    );
  });

  it("groups rows per bounty", () => {
    const grouped = collapseContributionFunders([
      row({ bountyId: "b1", userId: "u1", createdAt: at(1), displayName: "Ada" }),
      row({ bountyId: "b2", userId: "u2", createdAt: at(1), displayName: "Grace" }),
    ]);
    assert.equal(grouped.get("b1")?.funders[0]?.displayName, "Ada");
    assert.equal(grouped.get("b2")?.funders[0]?.displayName, "Grace");
    assert.equal(grouped.get("b1")?.funderCount, 1);
  });

  it("drops a repeated user id on the card and counts distinct funders", () => {
    const shown = dedupeShownFunders(
      [
        { userId: "enrique", displayName: "Enrique Gamboa", avatarUrl: null },
        { userId: "enrique", displayName: "Enrique Gamboa", avatarUrl: null },
      ],
      2,
    );
    assert.equal(shown.funderCount, 1);
    assert.equal(shown.funders.length, 1);
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

  it("renders one face when the same user id is listed twice", () => {
    const html = renderToStaticMarkup(
      createElement(FunderAvatarStack, {
        funderCount: 2,
        funders: [
          face("enrique", "Enrique Gamboa", "https://lh3.googleusercontent.com/a/enrique"),
          face("enrique", "Enrique Gamboa", "https://lh3.googleusercontent.com/a/enrique"),
        ],
      }),
    );
    assert.equal(html.match(/<img /g)?.length, 1);
    assert.match(html, /aria-label="Funded by Enrique Gamboa"/);
    assert.doesNotMatch(html, /\+[0-9]/);
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

describe("FunderContributionList", () => {
  it("shows a face, name, and amount on every row, including a repeat funder", () => {
    const html = renderToStaticMarkup(
      createElement(FunderContributionList, {
        currency: "USDC",
        contributions: [
          {
            id: "c1",
            displayName: "Enrique Gamboa",
            amountUsdc: "1.000000",
            avatarUrl: "https://lh3.googleusercontent.com/a/enrique",
          },
          {
            id: "c2",
            displayName: "Enrique Gamboa",
            amountUsdc: "1.000000",
            avatarUrl: "https://lh3.googleusercontent.com/a/enrique",
          },
        ],
      }),
    );
    assert.equal(html.match(/<img /g)?.length, 2);
    assert.equal(html.match(/Enrique Gamboa/g)?.length, 4);
    assert.match(html, /src="https:\/\/lh3.googleusercontent.com\/a\/enrique"/);
    assert.match(html, /1 USDC/);
    assert.doesNotMatch(html, />EG</);
  });

  it("uses the same initials fallback as the board when a picture is missing", () => {
    const html = renderToStaticMarkup(
      createElement(FunderContributionList, {
        currency: "USDC",
        contributions: [
          {
            id: "c1",
            displayName: "Ada Lovelace",
            amountUsdc: "5.000000",
            avatarUrl: null,
          },
        ],
      }),
    );
    assert.doesNotMatch(html, /<img /);
    assert.match(html, />AL</);
    assert.match(html, /title="Ada Lovelace"/);
    assert.match(html, /Ada Lovelace/);
    assert.match(html, /5 USDC/);
  });

  it("renders nothing when there are no contributions", () => {
    assert.equal(
      renderToStaticMarkup(
        createElement(FunderContributionList, { currency: "USDC", contributions: [] }),
      ),
      "",
    );
  });
});
