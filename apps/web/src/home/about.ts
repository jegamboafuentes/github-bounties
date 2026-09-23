import { NOT_LIGHTNING_BOUNTIES } from "./differentiators";
import { ROADMAP_INTRO } from "./roadmap";

/**
 * Public About copy.
 * Bios are the Lightning Bounties team page (https://www.lightningbounties.com/team),
 * lightly punctuated for readability. Do not add credentials that page does not state.
 * Pavel’s source line says “completely CS Masters”; the readable correction is “completing”.
 * Photos are vendored under apps/web/public/team. Do not hotlink Wix.
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
  mitStory: {
    href: "https://jegamboafuentes.medium.com/our-epic-win-at-the-mit-bitcoin-hackathon-2024-34fab944e78d",
    label: "Medium story",
    detail: "Our epic win at the MIT Bitcoin hackathon 2024.",
  },
  original: {
    href: "https://www.lightningbounties.com/",
    label: "Original product",
    detail: "Lightning Bounties, the product this chapter continues from.",
  },
} as const;

export const ABOUT_ROADMAP_CTA = {
  href: "/roadmap",
  heading: "Public roadmap",
  label: "See the roadmap",
  body: ROADMAP_INTRO,
} as const;

export const ABOUT_SOCIAL_KINDS = ["github", "linkedin", "x", "medium", "linktree"] as const;

export type AboutSocialKind = (typeof ABOUT_SOCIAL_KINDS)[number];

export type AboutSocialLink = {
  kind: AboutSocialKind;
  href: string;
};

export type AboutCofounder = {
  name: string;
  photo: string;
  photoAlt: string;
  bio: string;
  links: readonly AboutSocialLink[];
};

export const ABOUT_COFOUNDERS: readonly AboutCofounder[] = [
  {
    name: "Enrique Gamboa",
    photo: "/team/enrique.png",
    photoAlt: "Photo of Enrique Gamboa",
    bio: "Data Engineer in Biotech, Masters in Data Science. Founder, Metaverse Professional (tools for NFTs). Bilingual, bringing Web3 to Latin America.",
    links: [
      { kind: "github", href: "https://github.com/jegamboafuentes" },
      { kind: "linkedin", href: "https://www.linkedin.com/in/jegamboafuentes" },
      { kind: "x", href: "https://twitter.com/jegamboafuentes" },
      { kind: "medium", href: "https://jegamboafuentes.medium.com" },
    ],
  },
  {
    name: "Will Sutton",
    photo: "/team/will.png",
    photoAlt: "Photo of Will Sutton",
    bio: "Software engineering for financial services and conversational AI. Cofounder, BosLab (Boston’s open source biology hackerspace). Fascinated by tech collaboration models like Kaggle competitions.",
    links: [
      { kind: "github", href: "https://github.com/sutt" },
      { kind: "linkedin", href: "https://www.linkedin.com/in/willsutton17" },
      { kind: "x", href: "https://twitter.com/WillSuttonCodes" },
    ],
  },
  {
    name: "Pavel Kononov",
    photo: "/team/pavel.png",
    photoAlt: "Photo of Pavel Kononov",
    bio: "Developer for a merchant payments plugin and chip design CAD. Concentration in Security & Backend. Emigrated in 2022, currently completing CS Masters.",
    links: [
      { kind: "github", href: "https://github.com/super-jaba" },
      { kind: "linkedin", href: "https://www.linkedin.com/in/kononovp" },
    ],
  },
  {
    name: "Mike Abramo",
    photo: "/team/mike.png",
    photoAlt: "Photo of Mike Abramo",
    bio: "Token Economics Researcher @TokenomicsDAO. Core Contributor @BostonDAO. Figma and Canva power user.",
    links: [
      { kind: "github", href: "https://github.com/SonnyMonroe" },
      { kind: "linkedin", href: "https://www.linkedin.com/in/michael-abramo" },
      { kind: "x", href: "https://twitter.com/SonnyTheDegen" },
      { kind: "medium", href: "https://medium.com/@mabramo11" },
      { kind: "linktree", href: "https://mabramo-linktree.vercel.app" },
    ],
  },
];
