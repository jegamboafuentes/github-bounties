import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { registerAccessOpenApi } from "../access/openapi";
import { z } from "zod";
import { bountyStatusValues } from "../../db/schema";
import { DEV_SITE_HOST, PROD_SITE_HOST, originFromSiteUrl } from "../../lib/site-env";

extendZodWithOpenApi(z);

const bountyStatuses = [...bountyStatusValues] as [string, ...string[]];

const isoDateTime = z
  .string()
  .describe("ISO-8601 timestamp.")
  .openapi({ format: "date-time", example: "2026-09-24T00:00:00.000Z" });

export const bountyIdSchema = z
  .string()
  .uuid()
  .describe("Bounty id.");

export const listBountiesInputSchema = z
  .object({
    repo: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe("Case-insensitive substring of owner/name, for example octo/hello."),
    status: z
      .enum(bountyStatuses)
      .optional()
      .describe(
        "Bounty status. Omit for every status. pending_fund, funded, claim_locked, settling, settled, settled_partial, refunding, refunded, void, cancelled, expired.",
      ),
    complexity: z
      .enum(["S", "M", "L"])
      .optional()
      .describe("Cached intelligence complexity. S small, M medium, L large. Rows without a ready badge are excluded."),
    language: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Case-insensitive substring of the cached language stack. Rows without a ready badge are excluded."),
    has_intel: z
      .boolean()
      .optional()
      .describe("true: only bounties with a ready cached badge. false: only bounties without one."),
    sort: z
      .enum(["newest", "amount"])
      .default("newest")
      .describe("newest orders by created time descending. amount orders by face USDC descending. Both tie-break on id."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Page size. Default 20. Maximum 100."),
    cursor: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .optional()
      .describe("Opaque keyset cursor from the previous page's nextCursor. Must be used with the same sort."),
  })
  .openapi("ListBountiesQuery");

export const apiErrorSchema = z
  .object({
    error: z.object({
      code: z
        .string()
        .describe(
          "Stable code. API codes: validation_failed, not_found, method_not_allowed, rate_limited, internal, unauthorized, key_revoked, forbidden_scope, conflict, payment_required, spend_cap_exceeded, idempotency_key_required, idempotency_conflict, wallet_not_set, github_not_linked. Bounty and escrow domain codes (bounty_exists, not_poster, not_fundable, not_refundable, and the rest) pass through unchanged.",
        ),
      message: z.string(),
      details: z.unknown().nullable(),
    }),
  })
  .openapi("ApiError");

const intelBadgeSchema = z
  .object({
    complexity: z.enum(["S", "M", "L"]),
    languageStack: z.string(),
  })
  .openapi("IntelligenceBadge");

const funderAvatarSchema = z
  .object({
    displayName: z.string(),
    avatarUrl: z.string().url().nullable(),
  })
  .openapi("FunderAvatar");

export const payoutScheduleSchema = z
  .object({
    faceUsdc: z
      .string()
      .describe(
        "Face the fee math uses. Top-ups increase this amount. This is the posted face, not totalFundedUsdc.",
      ),
    feeUsdc: z.string().describe("2% of face, taken at settlement."),
    feeBps: z.number().int(),
    poolBpsOfPostFee: z.number().int().describe("1500 = 15% of post-fee, not of face."),
    winnerUsdc: z.string(),
    poolTotalUsdc: z.string(),
    eachUsdc: z.string().nullable(),
    eligibleCount: z.number().int(),
    emptyPool: z.boolean(),
    schedule: z
      .enum(["empty_pool", "roster"])
      .describe(
        "empty_pool is the list schedule before a roster is loaded (winner receives 100% of post-fee). roster is the live split on the bounty detail.",
      ),
  })
  .openapi("PayoutSchedule");

export const publicBountySchema = z
  .object({
    id: z.string().uuid(),
    issue: z.object({
      url: z.string().url(),
      repo: z.string(),
      number: z.number().int(),
      title: z.string(),
    }),
    status: z
      .string()
      .describe(
        "Bounty status. pending_fund is a posted face with no confirmed lock. funded and claim_locked are open and locked. settling, settled, and settled_partial are payout. refunding means a return is in progress. cancelled and expired are terminal: the draft was voided before lock, or a locked bounty was refunded in full with no fee. refunded and void are terminal too. Read status before treating totalFundedUsdc as money still held.",
      ),
    currency: z.string(),
    amountUsdc: z
      .string()
      .describe(
        "Face USDC: the posted amount, including top-ups after lock. The fee schedule uses this. It is set when the bounty is created, before any contribution is confirmed.",
      ),
    totalFundedUsdc: z
      .string()
      .describe(
        "Verified USDC inflow as 6-decimal USDC: the original escrow fund when escrows.fund_tx_hash is recorded, plus confirmed bounty_contributions, counting each fund transaction hash once. A Lock writes that same hash on a contribution, and a top-up stores the new face on the escrow, so those amounts are not added twice. 0.000000 when there is no verified inflow. This is not the face in amountUsdc. A pending_fund bounty can show a face while this is 0.000000. Cancelled, expired, refunding, and refunded bounties still return this confirmed amount; status says that sum was voided or returned and is not still locked.",
      ),
    createdAt: isoDateTime,
    fundedAt: isoDateTime.nullable(),
    payout: payoutScheduleSchema,
    intelligence: intelBadgeSchema.nullable(),
    funders: z.object({
      count: z.number().int().describe("Distinct funders, including people past the avatar cap."),
      avatars: z
        .array(funderAvatarSchema)
        .describe(
          "Up to 5 distinct funders, newest contribution first. Same order as the board avatar stack: the first face is the newest and is drawn on top. The funders route uses the same recency order, one row per contribution.",
        ),
    }),
    poster: z.object({
      displayName: z.string(),
      githubLogin: z.string().nullable(),
    }),
  })
  .openapi("PublicBounty");

export const bountyListResponseSchema = z
  .object({
    data: z.array(publicBountySchema),
    page: z.object({
      limit: z.number().int(),
      sort: z.enum(["newest", "amount"]),
      nextCursor: z.string().nullable(),
    }),
  })
  .openapi("BountyList");

const rosterMemberSchema = z
  .object({
    githubLogin: z.string(),
    role: z.string(),
    qualifyingPrNumber: z.number().int().nullable(),
    qualifyingPrUrl: z.string().nullable(),
    shareUsdc: z.string(),
    paid: z.boolean(),
    unlinked: z.boolean(),
    payoutTxHash: z.string().nullable(),
  })
  .openapi("PoolRosterMember");

const detailPayoutSchema = payoutScheduleSchema
  .extend({
    paidCount: z.number().int(),
    winnerShareLabel: z.string(),
    poolShareLabel: z.string(),
    feeTxHash: z.string().nullable(),
    winnerTxHash: z.string().nullable(),
  })
  .openapi("DetailPayout");

export const bountyDetailResponseSchema = z
  .object({
    bounty: publicBountySchema.extend({
      issue: publicBountySchema.shape.issue.extend({
        body: z.string().nullable().describe("Stored GitHub issue body. The API does not refetch GitHub."),
      }),
      payout: detailPayoutSchema,
    }),
    lock: z.object({
      exclusiveClaimLock: z.literal("retired"),
      activeLock: z.null(),
      note: z.string(),
    }),
    workSignals: z.array(
      z.object({
        githubLogin: z.string().nullable(),
        hunterLabel: z.string(),
        signaledAt: isoDateTime,
      }),
    ),
    escrow: z
      .object({
        status: z
          .string()
          .describe(
            "Escrow status. pending means the face is not locked yet. refunded means the confirmed contributions were returned. A poster cancel or expiry stores bounty status cancelled or expired once that return finishes.",
          ),
        amountUsdc: z
          .string()
          .describe(
            "Escrow face record. Top-ups rewrite this to the new face. Use bounty.totalFundedUsdc for verified inflow.",
          ),
        rail: z.string(),
        inboundRecorded: z.boolean(),
        failCode: z.string().nullable(),
        failLabel: z.string().nullable(),
      })
      .nullable(),
    roster: z.object({
      frozen: z.boolean(),
      frozenAt: isoDateTime.nullable(),
      overflowCount: z.number().int(),
      overflowCaption: z.string().nullable(),
      eligibilityFreezeCopy: z.string(),
      winner: rosterMemberSchema.nullable(),
      pool: z.array(rosterMemberSchema),
      overflow: z.array(rosterMemberSchema),
      excludedPoster: rosterMemberSchema.nullable(),
    }),
    pendingHunterLink: z
      .object({
        winnerLogin: z.string(),
        prNumber: z.number().int().nullable(),
      })
      .nullable(),
  })
  .openapi("BountyDetail");

export const funderContributionSchema = z
  .object({
    displayName: z.string(),
    githubLogin: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
    amountUsdc: z.string(),
    createdAt: isoDateTime,
  })
  .openapi("FunderContribution");

export const funderListResponseSchema = z
  .object({
    bountyId: z.string().uuid(),
    data: z
      .array(funderContributionSchema)
      .describe(
        "One row per contribution, newest first (created time descending, then id descending). Same recency order as bounty.funders.avatars and the board avatar stack. Wallet addresses are omitted.",
      ),
  })
  .openapi("FunderList");

export const intelligenceResponseSchema = z
  .object({
    bountyId: z.string().uuid(),
    cached: z.boolean(),
    status: z.enum(["ready", "error", "not_cached"]),
    repoAbout: z.string().optional(),
    languageStack: z.string().optional(),
    complexity: z.enum(["S", "M", "L"]).optional(),
    model: z.string().nullable().optional(),
    reason: z.string().optional(),
    generatedAt: isoDateTime.optional(),
    estimateLabel: z.string(),
  })
  .openapi("CachedIntelligence");

export const bountyIdParamsSchema = z.object({
  id: bountyIdSchema,
});

export const publicApiRegistry = new OpenAPIRegistry();

const errorResponses = {
  400: {
    description: "The query or path failed validation.",
    content: { "application/json": { schema: apiErrorSchema } },
  },
  404: {
    description: "No bounty with that id.",
    content: { "application/json": { schema: apiErrorSchema } },
  },
  429: {
    description: "Per-IP limit on this instance. See Retry-After and RateLimit headers.",
    content: { "application/json": { schema: apiErrorSchema } },
  },
  405: {
    description:
      "POST, PUT, PATCH, and DELETE are not allowed. The body is the same JSON error envelope. Allow lists the supported methods (RFC 9110).",
    headers: {
      Allow: {
        description: "RFC 9110 Allow. These routes accept GET and OPTIONS.",
        schema: { type: "string", example: "GET, OPTIONS" },
      },
    },
    content: { "application/json": { schema: apiErrorSchema } },
  },
  500: {
    description: "Unexpected server error.",
    content: { "application/json": { schema: apiErrorSchema } },
  },
} as const;

publicApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/bounties",
  summary: "List and filter the bounty board",
  description:
    "Public board rows with keyset pagination. Intelligence filters use the cache only and do not call Gemini. amountUsdc is the face. totalFundedUsdc is the verified escrow fund plus confirmed contributions, each fund hash once (0.000000 when there is no verified inflow). The list payout is the empty-pool schedule on the face; the live roster split is on the detail route. funders.avatars are newest contribution first.",
  request: { query: listBountiesInputSchema },
  responses: {
    200: {
      description: "One page of bounties.",
      content: { "application/json": { schema: bountyListResponseSchema } },
    },
    400: errorResponses[400],
    405: errorResponses[405],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

publicApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/bounties/{id}",
  summary: "Read one bounty",
  description:
    "Issue body snapshot, status, payout breakdown, pool roster, and read-only lock state. Wallet addresses are omitted. The issue body is the stored snapshot and is not refetched. amountUsdc and payout.faceUsdc are the face. totalFundedUsdc is the verified escrow fund plus confirmed contributions, each fund hash once. status cancelled, expired, refunding, or refunded means that sum is not still locked.",
  request: { params: bountyIdParamsSchema },
  responses: {
    200: {
      description: "Public bounty detail.",
      content: { "application/json": { schema: bountyDetailResponseSchema } },
    },
    400: errorResponses[400],
    404: errorResponses[404],
    405: errorResponses[405],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

publicApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/bounties/{id}/funders",
  summary: "List contributions",
  description:
    "One row per contribution, newest first (created time descending, then id descending). Same recency order as bounty.funders.avatars and the board avatar stack. Public fields only: display name, GitHub login, avatar, amount, and time. Wallet addresses are omitted.",
  request: { params: bountyIdParamsSchema },
  responses: {
    200: {
      description: "Contribution rows.",
      content: { "application/json": { schema: funderListResponseSchema } },
    },
    400: errorResponses[400],
    404: errorResponses[404],
    405: errorResponses[405],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

publicApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/bounties/{id}/intelligence",
  summary: "Read cached intelligence",
  description:
    "Returns the stored Gemini cache row. Never calls Gemini and never refreshes the cache. not_cached means no row is stored.",
  request: { params: bountyIdParamsSchema },
  responses: {
    200: {
      description: "Cached intelligence, or not_cached.",
      content: { "application/json": { schema: intelligenceResponseSchema } },
    },
    400: errorResponses[400],
    404: errorResponses[404],
    405: errorResponses[405],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

publicApiRegistry.registerPath({
  method: "get",
  path: "/api/v1/stats",
  summary: "Platform stats",
  description: "Same aggregate payload as the public website stats.",
  responses: {
    200: {
      description: "Platform stats.",
      content: {
        "application/json": {
          schema: z
            .object({
              ok: z.literal(true),
              schemaVersion: z.number().int(),
              generatedAt: isoDateTime,
              product: z.string(),
              currency: z.string(),
            })
            .passthrough()
            .openapi("PlatformStats"),
        },
      },
    },
    405: errorResponses[405],
    429: errorResponses[429],
    500: errorResponses[500],
  },
});

export const PUBLIC_API_DESCRIPTION = [
  "GitHub Bounties pays USDC on a public GitHub issue when a pull request that closes it is merged. Hunters work in parallel. Anonymous reads of the board, one bounty, its funders, cached issue intelligence, and platform stats do not require an API key. V4-2 adds Bearer API keys for /me, posting, work signals, unfunded cancel, and headless x402 fund and top-up (money is DEV-only until API_MONEY_ENABLED is turned on for mainnet).",
  "amountUsdc and payout.faceUsdc are the face (the posted amount, including top-ups). totalFundedUsdc is the verified original escrow fund (counted when escrows.fund_tx_hash is recorded) plus confirmed bounty_contributions, counting each fund transaction hash once. A Lock stores that hash on a contribution, and a top-up rewrites the escrow amount to the new face, so neither is added twice. It is 0.000000 when there is no verified inflow. It is not the face. status cancelled, expired, refunding, or refunded means that confirmed amount is not still locked.",
  "POST, PUT, PATCH, and DELETE on /api/v1 return 405 with Allow: GET, OPTIONS (RFC 9110) and the JSON error envelope (code method_not_allowed).",
  "Funder avatars and the funders route are newest contribution first, matching the board avatar stack. Avatars are distinct funders, capped at five. The funders route is one row per contribution.",
  "Rate limit: about 60 requests per minute per client IP, counted in memory on each Cloud Run instance. It is not a global limit across instances. The client IP is the last address in X-Forwarded-For (the hop Cloud Run appends). A limited response is HTTP 429 with error code rate_limited, Retry-After, and RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset headers.",
  "Authenticated calls use Authorization: Bearer and no cookies. Per key, reads are 120/minute, writes are 20/minute, and money calls are 10/hour. Those counters are rows in api_request_log so they hold across Cloud Run instances. Money endpoints stay off when CDP_NETWORK=base unless API_MONEY_ENABLED is explicitly on.",
].join("\n\n");

registerAccessOpenApi(publicApiRegistry);

let cachedDocument: ReturnType<OpenApiGeneratorV31["generateDocument"]> | undefined;

const OPENAPI_DEV_SERVER = {
  url: "https://dev.githubbounties.xyz",
  description: "DEV (Base Sepolia)",
};
const OPENAPI_PROD_SERVER = {
  url: "https://githubbounties.xyz",
  description: "PROD (Base mainnet)",
};

export type OpenApiServerContext = {
  /** `X-Forwarded-Host` or `Host`. Untrusted hosts are ignored. */
  host?: string | null;
  /**
   * Used when `host` is missing or not a public site host.
   * `NEXT_PUBLIC_APP_URL`, then `APP_BASE_URL`, then `PUBLIC_BASE_URL`, then `AUTH_URL`.
   */
  env?: Record<string, string | undefined>;
};

function firstHeaderValue(value: string | null | undefined): string {
  return value?.split(",")[0]?.trim() ?? "";
}

function publicSiteKind(value: string | null | undefined): "dev" | "prod" | null {
  const origin = originFromSiteUrl(firstHeaderValue(value));
  if (!origin) return null;
  let host = "";
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === DEV_SITE_HOST || host.endsWith(`.${DEV_SITE_HOST}`)) return "dev";
  if (host === PROD_SITE_HOST || host === `www.${PROD_SITE_HOST}`) return "prod";
  return null;
}

/**
 * Current public origin first, the other origin second.
 * Swagger Try it out uses servers[0], so PROD must not list DEV first.
 * A localhost or raw Cloud Run host is not listed; the app origin env is used instead.
 * When neither names DEV or PROD, DEV stays first so the document still lists both public origins.
 */
export function orderOpenApiServers(input: OpenApiServerContext = {}): Array<{
  url: string;
  description: string;
}> {
  const env = input.env ?? process.env;
  const kind =
    publicSiteKind(input.host) ??
    publicSiteKind(env.NEXT_PUBLIC_APP_URL) ??
    publicSiteKind(env.APP_BASE_URL) ??
    publicSiteKind(env.PUBLIC_BASE_URL) ??
    publicSiteKind(env.AUTH_URL);
  if (kind === "prod") return [OPENAPI_PROD_SERVER, OPENAPI_DEV_SERVER];
  return [OPENAPI_DEV_SERVER, OPENAPI_PROD_SERVER];
}

export function buildOpenApiDocument(input: OpenApiServerContext = {}) {
  if (!cachedDocument) {
    const generator = new OpenApiGeneratorV31(publicApiRegistry.definitions);
    cachedDocument = generator.generateDocument({
      openapi: "3.1.0",
      info: {
      title: "GitHub Bounties API",
      version: "4.2.0",
      description: PUBLIC_API_DESCRIPTION,
    },
      servers: [OPENAPI_DEV_SERVER, OPENAPI_PROD_SERVER],
    });
  }
  return {
    ...cachedDocument,
    servers: orderOpenApiServers(input),
  };
}

export type ListBountiesInput = z.infer<typeof listBountiesInputSchema>;
