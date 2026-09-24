import type { FundChainDisplayName } from "../bounties/display";
import { FEE_BPS, POOL_BPS_OF_POST_FEE, POOL_MAX_PAID } from "../lib/constants";

/**
 * Homepage scroll story. Replaces the Modules list.
 * Copy describes shipped behavior only (ADR 0001 fee, ADR 0003 85/15 of post-fee).
 * No crowdfunding, no new fee math.
 */

const feePct = FEE_BPS / 100;
const poolPct = POOL_BPS_OF_POST_FEE / 100;
const winnerPct = 100 - poolPct;
const postFeeOfFace = 100 - feePct;

/** Figure caption for the Base step. Chain name comes from the existing fund runtime. */
export function storyChainCaption(chainName: FundChainDisplayName): string {
  return `Any bring-your-own Base address. Settlement uses ${chainName}.`;
}

export const STORY_HEADING = "How a bounty moves";

export const STORY_LEDE =
  "Six steps already in the product. Scroll moves the picture. It does not change the fee, the escrow, or who can claim.";

export const STORY_STEP_IDS = [
  "paste",
  "escrow",
  "intelligence",
  "split",
  "merge",
  "base",
] as const;

export type StoryStepId = (typeof STORY_STEP_IDS)[number];

export type StoryStep = {
  id: StoryStepId;
  kicker: string;
  title: string;
  detail?: string;
  body: string;
};

export const STORY_STEPS: readonly StoryStep[] = [
  {
    id: "paste",
    kicker: "01",
    title: "Paste a GitHub issue",
    detail: "The issue stays the work",
    body: "Post a bounty by pasting a GitHub issue URL. The public board lists it, and the bounty page keeps the full issue. This does not open a second tracker.",
  },
  {
    id: "escrow",
    kicker: "02",
    title: "Secure USDC escrow",
    detail: "Face locks in gb-escrow",
    body: `Fund locks the face amount of USDC in gb-escrow via x402 exact. The ${feePct}% fee is taken at settlement, not at fund. Cancel or expiry refunds the full face. Hosted checkout is disabled.`,
  },
  {
    id: "intelligence",
    kicker: "03",
    title: "AI bounty intelligence",
    detail: "Estimates only",
    body: "A server-side card summarizes the repo (about and language stack) and estimates issue complexity as S, M, or L. Those are cached AI estimates — not a price and not a payout. If the model key is missing, the bounty page still works.",
  },
  {
    id: "split",
    kicker: "04",
    title: "Fair 85/15 hunter split",
    detail: "Post-fee winner / pool",
    body: `After the ${feePct}% fee, ${winnerPct}% of post-fee goes to the winning merge author and ${poolPct}% of post-fee is split equally among up to ${POOL_MAX_PAID} eligible hunters. An empty pool pays the winner 100% of post-fee (${postFeeOfFace}% of face). A participation pool for eligible hunters — not a public fundraise.`,
  },
  {
    id: "merge",
    kicker: "05",
    title: "Merge / Claim",
    detail: "Merge is truth",
    body: "The winner is the author of the merged pull request that closes funded issue #N. They claim their winner share to a bring-your-own Base address. Each pool member claims their own frozen share. Optional Working on this does not pay anyone, and the exclusive claim-lock is retired.",
  },
  {
    id: "base",
    kicker: "06",
    title: "Global Base settlement",
    detail: "USDC on Base",
    body: "Settlement is USDC on Base, to any bring-your-own Base address. The chain is Base — not Lightning, and not a second network.",
  },
];
