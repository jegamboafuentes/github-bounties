import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ABOUT_BIOS_NOTE,
  ABOUT_CHAPTER,
  ABOUT_COFOUNDERS,
  ABOUT_CONTINUES,
  ABOUT_DISTINCTION,
  ABOUT_LINKS,
  ABOUT_ROADMAP_CTA,
} from "./about";
import { NOT_LIGHTNING_BOUNTIES } from "./differentiators";
import { ROADMAP_INTRO } from "./roadmap";

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

  it("links the MIT win, the Medium story, and the original product", () => {
    assert.equal(ABOUT_LINKS.mit.href, "https://devpost.com/software/lightning-bounty");
    assert.equal(ABOUT_LINKS.mit.label, "MIT genesis / win");
    assert.match(ABOUT_LINKS.mit.detail, /MIT Bitcoin Hackathon Scaling Up/);
    assert.match(ABOUT_LINKS.mit.detail, /Track 1: Bitcoin, Lightning & Taproot/);
    assert.match(ABOUT_LINKS.mit.detail, /Zero Hash/);
    assert.equal(
      ABOUT_LINKS.mitStory.href,
      "https://jegamboafuentes.medium.com/our-epic-win-at-the-mit-bitcoin-hackathon-2024-34fab944e78d",
    );
    assert.equal(ABOUT_LINKS.mitStory.label, "Medium story");
    assert.match(ABOUT_LINKS.mitStory.detail, /MIT Bitcoin hackathon 2024/);
    assert.equal(ABOUT_LINKS.original.href, "https://www.lightningbounties.com/");
    assert.equal(ABOUT_LINKS.original.label, "Original product");
  });

  it("points at the public roadmap without inventing dates", () => {
    assert.equal(ABOUT_ROADMAP_CTA.href, "/roadmap");
    assert.equal(ABOUT_ROADMAP_CTA.label, "See the roadmap");
    assert.equal(ABOUT_ROADMAP_CTA.body, ROADMAP_INTRO);
    assert.match(ABOUT_ROADMAP_CTA.body, /No invented ship dates/);
    assert.doesNotMatch(ABOUT_ROADMAP_CTA.body, /\bQ[1-4]\b|\b20\d{2}-\d{2}-\d{2}\b/);
  });

  it("uses local headshots and the given profile URLs", () => {
    const byName = Object.fromEntries(ABOUT_COFOUNDERS.map((person) => [person.name, person]));
    const hrefs = (name: string) => (byName[name]?.links ?? []).map((link) => link.href);

    assert.equal(byName["Enrique Gamboa"]?.photo, "/team/enrique.png");
    assert.equal(byName["Enrique Gamboa"]?.photoAlt, "Photo of Enrique Gamboa");
    assert.deepEqual(hrefs("Enrique Gamboa"), [
      "https://github.com/jegamboafuentes",
      "https://www.linkedin.com/in/jegamboafuentes",
      "https://twitter.com/jegamboafuentes",
      "https://jegamboafuentes.medium.com",
    ]);

    assert.equal(byName["Will Sutton"]?.photo, "/team/will.png");
    assert.deepEqual(hrefs("Will Sutton"), [
      "https://github.com/sutt",
      "https://www.linkedin.com/in/willsutton17",
      "https://twitter.com/WillSuttonCodes",
    ]);

    assert.equal(byName["Pavel Kononov"]?.photo, "/team/pavel.png");
    assert.deepEqual(hrefs("Pavel Kononov"), [
      "https://github.com/super-jaba",
      "https://www.linkedin.com/in/kononovp",
    ]);

    assert.equal(byName["Mike Abramo"]?.photo, "/team/mike.png");
    assert.deepEqual(hrefs("Mike Abramo"), [
      "https://github.com/SonnyMonroe",
      "https://www.linkedin.com/in/michael-abramo",
      "https://twitter.com/SonnyTheDegen",
      "https://medium.com/@mabramo11",
      "https://mabramo-linktree.vercel.app",
    ]);

    for (const person of ABOUT_COFOUNDERS) {
      assert.match(person.photo, /^\/team\/[a-z]+\.png$/);
      assert.doesNotMatch(person.photo, /^https?:/i);
      assert.doesNotMatch(JSON.stringify(person), /wixstatic|wix\.com/i);
      for (const link of person.links) {
        assert.match(link.href, /^https:\/\//);
      }
    }
  });
});
