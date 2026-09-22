import { NOT_LIGHTNING_BOUNTIES } from "./differentiators";

/**
 * Public About copy.
 * Bios are the Lightning Bounties team page (https://www.lightningbounties.com/team),
 * lightly punctuated for readability. Do not add credentials that page does not state.
 * Pavel’s source line says “completely CS Masters”; the readable correction is “completing”.
 */

export const ABOUT_CHAPTER =
  "GitHub Bounties is the next chapter of Lightning Bounties — the same cofounders, not a new origin.";

export const ABOUT_CONTINUES =
  "Lightning Bounties began as a hackathon project and is still the original product. This chapter pays merged GitHub work in USDC on Base.";

export const ABOUT_DISTINCTION = `${NOT_LIGHTNING_BOUNTIES} Same people, next chapter: USDC on Base for a merged pull request, not Lightning invoices or a renamed LB1.`;

export const ABOUT_BIOS_NOTE =
  "Bios follow the Lightning Bounties team page, lightly edited for readability.";

export const ABOUT_LINKS = {
  mit: {
    href: "https://devpost.com/software/lightning-bounty",
    label: "MIT genesis / win",
    detail:
      "MIT Bitcoin Hackathon Scaling Up. Winner, Track 1: Bitcoin, Lightning & Taproot, presented by Zero Hash.",
  },
  original: {
    href: "https://www.lightningbounties.com/",
    label: "Original product",
    detail: "Lightning Bounties, the product this chapter continues from.",
  },
} as const;

export type AboutCofounder = {
  name: string;
  initials: string;
  bio: string;
};

export const ABOUT_COFOUNDERS: readonly AboutCofounder[] = [
  {
    name: "Enrique Gamboa",
    initials: "EG",
    bio: "Data Engineer in Biotech, Masters in Data Science. Founder, Metaverse Professional (tools for NFTs). Bilingual, bringing Web3 to Latin America.",
  },
  {
    name: "Will Sutton",
    initials: "WS",
    bio: "Software engineering for financial services and conversational AI. Cofounder, BosLab (Boston’s open source biology hackerspace). Fascinated by tech collaboration models like Kaggle competitions.",
  },
  {
    name: "Pavel Kononov",
    initials: "PK",
    bio: "Developer for a merchant payments plugin and chip design CAD. Concentration in Security & Backend. Emigrated in 2022, currently completing CS Masters.",
  },
  {
    name: "Mike Abramo",
    initials: "MA",
    bio: "Token Economics Researcher @TokenomicsDAO. Core Contributor @BostonDAO. Figma and Canva power user.",
  },
];
