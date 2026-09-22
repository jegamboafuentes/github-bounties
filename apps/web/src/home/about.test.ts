import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABOUT_BIOS_NOTE,
  ABOUT_CHAPTER,
  ABOUT_COFOUNDERS,
  ABOUT_CONTINUES,
  ABOUT_DISTINCTION,
  ABOUT_LINKS,
} from "./about";
import { NOT_LIGHTNING_BOUNTIES } from "./differentiators";

describe("about page copy", () => {
  it("frames the next chapter without inventing a new origin", () => {
    assert.match(ABOUT_CHAPTER, /next chapter of Lightning Bounties/i);
    assert.match(ABOUT_CHAPTER, /not a new origin/i);
    assert.match(ABOUT_CONTINUES, /original product/i);
    assert.match(ABOUT_CONTINUES, /USDC on Base/);
    assert.match(ABOUT_DISTINCTION, /USDC on Base/);
    assert.ok(ABOUT_DISTINCTION.includes(NOT_LIGHTNING_BOUNTIES));
    assert.match(ABOUT_BIOS_NOTE, /Lightning Bounties team page/i);
  });

  it("keeps the four cofounders and the team-page bios", () => {
    assert.deepEqual(
      ABOUT_COFOUNDERS.map((person) => person.name),
      ["Enrique Gamboa", "Will Sutton", "Pavel Kononov", "Mike Abramo"],
    );

    const enrique = ABOUT_COFOUNDERS[0]?.bio ?? "";
    assert.match(enrique, /Data Engineer in Biotech/);
    assert.match(enrique, /Masters in Data Science/);
    assert.match(enrique, /Metaverse Professional/);
    assert.match(enrique, /NFTs/);
    assert.match(enrique, /Web3 to Latin America/);

    const will = ABOUT_COFOUNDERS[1]?.bio ?? "";
    assert.match(will, /financial services/);
    assert.match(will, /conversational AI/);
    assert.match(will, /BosLab/);
    assert.match(will, /Boston’s open source biology hackerspace/);
    assert.match(will, /Kaggle/);

    const pavel = ABOUT_COFOUNDERS[2]?.bio ?? "";
    assert.match(pavel, /merchant payments plugin/);
    assert.match(pavel, /chip design CAD/);
    assert.match(pavel, /Security & Backend/);
    assert.match(pavel, /2022/);
    assert.match(pavel, /completing CS Masters/);
    assert.doesNotMatch(pavel, /completely CS Masters/);

    const mike = ABOUT_COFOUNDERS[3]?.bio ?? "";
    assert.match(mike, /Token Economics Researcher @TokenomicsDAO/);
    assert.match(mike, /Core Contributor @BostonDAO/);
    assert.match(mike, /Figma and Canva power user/);
  });

  it("links the MIT win and the original product", () => {
    assert.equal(ABOUT_LINKS.mit.href, "https://devpost.com/software/lightning-bounty");
    assert.equal(ABOUT_LINKS.mit.label, "MIT genesis / win");
    assert.match(ABOUT_LINKS.mit.detail, /MIT Bitcoin Hackathon Scaling Up/);
    assert.match(ABOUT_LINKS.mit.detail, /Track 1: Bitcoin, Lightning & Taproot/);
    assert.match(ABOUT_LINKS.mit.detail, /Zero Hash/);
    assert.equal(ABOUT_LINKS.original.href, "https://www.lightningbounties.com/");
    assert.equal(ABOUT_LINKS.original.label, "Original product");
  });
});
