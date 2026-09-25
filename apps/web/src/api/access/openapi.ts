import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { API_ERROR_CODES } from "../public/errors";

extendZodWithOpenApi(z);

export const createBountyBodySchema = z
  .object({
    issueUrl: z.string().trim().min(1).max(500).describe("Public GitHub issue URL."),
    amountUsdc: z.string().trim().min(1).max(40).describe("Face USDC. Creates pending_fund only."),
  })
  .strict()
  .openapi("CreateBountyBody");

export const topUpBodySchema = z
  .object({
    amountUsdc: z.string().trim().min(1).max(40).describe("USDC to add. No address fields."),
  })
  .strict()
  .openapi("TopUpBody");

export const fundBodySchema = z
  .object({})
  .strict()
  .openapi("FundBody");

export const claimBodySchema = z
  .object({
    kind: z.enum(["winner", "pool"]).describe("winner pays the merged-PR author share. pool pays the caller's own frozen share."),
  })
  .strict()
  .openapi("ClaimBody");

export const refundBodySchema = z
  .object({})
  .strict()
  .openapi("RefundBody");

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe("Required. The same key and body replay. A different body is idempotency_conflict.");

export const paymentSignatureSchema = z
  .string()
  .min(1)
  .optional()
  .describe("x402 PAYMENT-SIGNATURE. Omit on the first call to receive 402.");

const idSchema = z.string().uuid();

const usdcDecimal = z
  .string()
  .regex(/^\d+\.\d{6}$/)
  .describe("USDC decimal string with 6 fractional digits.");

const usdcDecimalOrNull = usdcDecimal.nullable();

export const cancelToolSchema = z.object({
  id: idSchema.describe("Bounty id."),
  idempotencyKey: idempotencyKeySchema,
});

export const fundToolSchema = z.object({
  id: idSchema.describe("Bounty id."),
  idempotencyKey: idempotencyKeySchema,
  paymentSignature: paymentSignatureSchema,
});

export const topUpToolSchema = fundToolSchema.extend({
  amountUsdc: z.string().trim().min(1).max(40),
});

export const workSignalToolSchema = z.object({
  id: idSchema.describe("Bounty id."),
});

export const claimToolSchema = z
  .object({
    id: idSchema.describe("Bounty id."),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const refundToolSchema = claimToolSchema;

export const bountyClaimsToolSchema = z
  .object({
    id: idSchema.describe("Bounty id."),
  })
  .strict();

export const createBountyToolSchema = createBountyBodySchema;

const errorRef = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().nullable(),
  }),
});

const createdBountySchema = z
  .object({
    id: z.string().uuid(),
    status: z.literal("pending_fund"),
    title: z.string(),
    amountUsdc: z.string(),
    issueUrl: z.string().url(),
  })
  .openapi("CreatedBounty");

const meSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string(),
    email: z.string(),
    walletAddress: z.string().nullable(),
    githubLogin: z.string().nullable(),
    apiKey: z.object({
      id: z.string().uuid(),
      name: z.string(),
      prefix: z.string(),
      env: z.enum(["test", "live"]),
      scopes: z.array(z.enum(["read", "write", "money"])),
      perTxCapUsdc: usdcDecimalOrNull.describe("Null when this key does not have the money scope. Cap enforcement is unchanged."),
      dailyCapUsdc: usdcDecimalOrNull.describe("Null when this key does not have the money scope. Cap enforcement is unchanged."),
    }),
  })
  .openapi("Me");

function json(schema: z.ZodType) {
  return { "application/json": { schema } };
}

const errorContent = { content: json(errorRef) };

/**
 * Bearer security and the V4-2 routes. Registered on the same OpenAPI registry
 * as the V4-1 reads.
 */
export function registerAccessOpenApi(registry: OpenAPIRegistry): void {
  registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "API key",
    description:
      "API key sent as Authorization: Bearer. gb_test_ on DEV (Base Sepolia), gb_live_ on mainnet. No cookies. Scopes: read, write, money.",
  });

  const bearer = [{ bearerAuth: [] }];
  const codes = API_ERROR_CODES.join(", ");

  registry.registerPath({
    method: "get",
    path: "/api/v1/me",
    operationId: "getMe",
    summary: "Current key owner",
    description: `The human user that owns the API key. Does not include google_sub. Error codes include ${codes}. Domain codes from bounty and escrow pass through unchanged.`,
    security: bearer,
    responses: {
      200: { description: "Key owner.", content: json(meSchema) },
      401: { description: "Missing, invalid, or revoked key.", ...errorContent },
      429: { description: "Per-key read limit (120/min).", ...errorContent },
    },
  });

  const usageSchema = z
    .object({
      perTxCapUsdc: usdcDecimalOrNull.describe(
        "This key's effective per-transaction cap. Null when the key has no money scope.",
      ),
      dailyCapUsdc: usdcDecimalOrNull.describe(
        "This key's effective UTC-day cap. Null when the key has no money scope.",
      ),
      spentTodayUsdc: usdcDecimalOrNull.describe(
        "Reserved plus recorded api_spend_ledger rows for this key since 00:00 UTC. Null when the key has no money scope.",
      ),
      remainingTodayUsdc: usdcDecimalOrNull.describe(
        "dailyCapUsdc minus spentTodayUsdc, never below zero. Null when the key has no money scope.",
      ),
      dayStart: z.string().datetime().describe("UTC day start used for spentTodayUsdc."),
      entries: z
        .array(
          z.object({
            amountUsdc: usdcDecimal,
            kind: z.enum(["fund", "top_up"]),
            bountyId: z.string().uuid(),
            txHash: z.string().nullable(),
            createdAt: z.string().datetime(),
          }),
        )
        .describe("Newest reserved or recorded ledger rows for this key. At most 50. No other user's rows."),
    })
    .openapi("KeyUsage");

  registry.registerPath({
    method: "get",
    path: "/api/v1/me/usage",
    operationId: "getMyUsage",
    summary: "This key's spend caps and recent ledger",
    description:
      "Scope read is enough. Returns the key's effective per-transaction cap, daily cap, USDC spent today (UTC, reserved and recorded rows in api_spend_ledger), remaining today, and up to 50 recent ledger entries for this key only. Each entry has amount, kind (fund or top_up), bounty id, tx hash, and time. Never another user's data.",
    security: bearer,
    responses: {
      200: { description: "Caps and ledger for the bearer key.", content: json(usageSchema) },
      401: { description: "Missing, invalid, or revoked key.", ...errorContent },
      403: { description: "Missing read scope.", ...errorContent },
      429: { description: "Per-key read limit (120/min).", ...errorContent },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/me/bounties",
    operationId: "listMyBounties",
    summary: "Bounties posted or funded by the key owner",
    description: "posted is bounties this user created. funded is contributions this user paid. Wallet addresses are omitted.",
    security: bearer,
    responses: {
      200: {
        description: "Posted and funded rows.",
        content: json(
          z.object({
            posted: z.array(z.object({
              id: z.string().uuid(),
              title: z.string(),
              status: z.string(),
              amountUsdc: z.string(),
              issueUrl: z.string(),
              createdAt: z.string(),
              fundedAt: z.string().nullable(),
            })),
            funded: z.array(z.object({
              bountyId: z.string().uuid(),
              title: z.string(),
              status: z.string(),
              amountUsdc: z.string(),
              contributionUsdc: z.string(),
              txHash: z.string(),
              createdAt: z.string(),
            })),
          }).openapi("MyBounties"),
        ),
      },
      401: { description: "Missing, invalid, or revoked key.", ...errorContent },
      429: { description: "Per-key read limit (120/min).", ...errorContent },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/bounties",
    operationId: "createBounty",
    summary: "Post a bounty",
    description: "Scope write. Creates pending_fund only. Same create path as the website. The body cannot include an address.",
    security: bearer,
    request: { body: { content: json(createBountyBodySchema) } },
    responses: {
      201: { description: "Pending fund bounty.", content: json(createdBountySchema) },
      400: { description: "Validation failed.", ...errorContent },
      401: { description: "Unauthorized or revoked.", ...errorContent },
      403: { description: "Missing write scope.", ...errorContent },
      409: { description: "An active bounty already exists for this issue.", ...errorContent },
      429: { description: "Per-key write limit (20/min).", ...errorContent },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/bounties/{id}/work-signal",
    operationId: "signalWorking",
    summary: "Signal Working on this",
    description: "Scope write. Non-exclusive. Does not change pool eligibility or money.",
    security: bearer,
    request: { params: z.object({ id: idSchema }) },
    responses: {
      200: { description: "Signal stored.", ...errorContent },
      401: { description: "Unauthorized.", ...errorContent },
      403: { description: "Missing write scope.", ...errorContent },
      404: { description: "Bounty not found.", ...errorContent },
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/api/v1/bounties/{id}/work-signal",
    operationId: "clearWorkSignal",
    summary: "Clear Working on this",
    description: "Scope write. Idempotent when no signal is active.",
    security: bearer,
    request: { params: z.object({ id: idSchema }) },
    responses: {
      200: { description: "Signal cleared.", ...errorContent },
      401: { description: "Unauthorized.", ...errorContent },
      403: { description: "Missing write scope.", ...errorContent },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/bounties/{id}/cancel",
    operationId: "cancelBounty",
    summary: "Cancel an unfunded bounty",
    description: "Scope write. Only pending_fund. Funded cancel is POST /refund (money scope). Idempotency-Key is required.",
    security: bearer,
    request: {
      params: z.object({ id: idSchema }),
      headers: z.object({ "Idempotency-Key": idempotencyKeySchema }),
    },
    responses: {
      200: { description: "Draft voided. No USDC movement.", ...errorContent },
      400: { description: "Idempotency-Key missing.", ...errorContent },
      401: { description: "Unauthorized.", ...errorContent },
      403: { description: "Missing write scope, or not the poster.", ...errorContent },
      409: {
        description:
          "Already cancelled (error code already_cancelled), funded bounty (not_refundable), or idempotency conflict. already_cancelled does not move USDC.",
        content: {
          "application/json": {
            schema: errorRef,
            example: {
              error: {
                code: "already_cancelled",
                message: "This bounty is already cancelled.",
                details: null,
              },
            },
          },
        },
      },
    },
  });

  const moneyDescription =
    "Scope money. DEV only unless API_MONEY_ENABLED is set. The first call returns 402 with payment requirements (amount is the face or the top-up, payTo is escrow) and approval_url. Retry with PAYMENT-SIGNATURE or X-PAYMENT and the same Idempotency-Key. The server settles through the facilitator and then locks or tops up. No pasted transaction hash. The body cannot include an address. Caps are checked before the 402 and again before the spend is recorded.";

  registry.registerPath({
    method: "post",
    path: "/api/v1/bounties/{id}/fund",
    operationId: "fundBounty",
    summary: "Fund with headless x402",
    description: `${moneyDescription} Poster only.`,
    security: bearer,
    request: {
      params: z.object({ id: idSchema }),
      headers: z.object({
        "Idempotency-Key": idempotencyKeySchema,
        "PAYMENT-SIGNATURE": paymentSignatureSchema,
      }),
    },
    responses: {
      200: { description: "Escrow locked.", ...errorContent },
      400: { description: "Validation failed, or Idempotency-Key missing.", ...errorContent },
      401: { description: "Missing, invalid, or revoked key.", ...errorContent },
      402: { description: "Payment required.", ...errorContent },
      403: { description: "Missing money scope, wallet, GitHub, or spend cap. Money may be disabled.", ...errorContent },
      409: { description: "Idempotency conflict, or bounty is not pending_fund.", ...errorContent },
      429: { description: "Per-key money limit (10/hour).", ...errorContent },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/bounties/{id}/top-up",
    operationId: "topUpBounty",
    summary: "Top up with headless x402",
    description: `${moneyDescription} Funded bounties only, before the winning merge.`,
    security: bearer,
    request: {
      params: z.object({ id: idSchema }),
      headers: z.object({
        "Idempotency-Key": idempotencyKeySchema,
        "PAYMENT-SIGNATURE": paymentSignatureSchema,
      }),
      body: { content: json(topUpBodySchema) },
    },
    responses: {
      200: { description: "Top-up applied.", ...errorContent },
      400: { description: "Validation failed, or Idempotency-Key missing.", ...errorContent },
      401: { description: "Missing, invalid, or revoked key.", ...errorContent },
      402: { description: "Payment required.", ...errorContent },
      403: { description: "Missing money scope, wallet, GitHub, or spend cap.", ...errorContent },
      409: { description: "Idempotency conflict, or top-ups are closed.", ...errorContent },
      429: { description: "Per-key money limit (10/hour).", ...errorContent },
    },
  });

  const claimDescription =
    "Scope money. DEV only unless API_MONEY_ENABLED is set. Pays the wallet saved for the key owner. The body cannot include an address, destination, or user id. Linked GitHub login must match the winner or the caller's own pool member. Idempotency-Key is required. A replay returns the stored response and does not pay again.";

  registry.registerPath({
    method: "post",
    path: "/api/v1/bounties/{id}/claim",
    operationId: "claimBounty",
    summary: "Claim the winner share or the caller's pool share",
    description: `${claimDescription} kind winner calls the website winner Claim. kind pool calls the website pool Claim.`,
    security: bearer,
    request: {
      params: z.object({ id: idSchema }),
      headers: z.object({ "Idempotency-Key": idempotencyKeySchema }),
      body: { content: json(claimBodySchema) },
    },
    responses: {
      200: { description: "Claim recorded. destination is the saved wallet.", ...errorContent },
      400: { description: "Address, user id, or Idempotency-Key rejected.", ...errorContent },
      401: { description: "Missing, invalid, or revoked key.", ...errorContent },
      403: { description: "Money disabled, missing scope, GitHub login mismatch, or not the winner or pool member.", ...errorContent },
      409: { description: "Idempotency conflict, or the pool is not ready.", ...errorContent },
      429: { description: "Per-key money limit (10/hour).", ...errorContent },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/bounties/{id}/claims",
    operationId: "listBountyClaims",
    summary: "Payout status for the caller's legs",
    description: "Scope read. The caller's own winner and pool legs on this bounty: status, amount, and tx hash. Other hunters are omitted.",
    security: bearer,
    request: { params: z.object({ id: idSchema }) },
    responses: {
      200: { description: "Caller legs. Empty when this user has none.", ...errorContent },
      401: { description: "Unauthorized.", ...errorContent },
      404: { description: "Bounty not found.", ...errorContent },
      429: { description: "Per-key read limit (120/min).", ...errorContent },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/api/v1/me/claims",
    operationId: "listMyClaims",
    summary: "The caller's claims across bounties",
    description: "Scope read. Winner claims and pool shares for this key's user, with status and tx hashes.",
    security: bearer,
    responses: {
      200: { description: "Caller claims.", ...errorContent },
      401: { description: "Unauthorized.", ...errorContent },
      429: { description: "Per-key read limit (120/min).", ...errorContent },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/v1/bounties/{id}/refund",
    operationId: "refundBounty",
    summary: "Refund a funded bounty to the recorded payer",
    description:
      "Scope money. DEV only unless API_MONEY_ENABLED is set. Poster only. The refund goes to the recorded on-chain payer, never a caller-supplied address. Idempotency-Key is required. Unfunded drafts use POST /cancel.",
    security: bearer,
    request: {
      params: z.object({ id: idSchema }),
      headers: z.object({ "Idempotency-Key": idempotencyKeySchema }),
      body: { content: json(refundBodySchema) },
    },
    responses: {
      200: { description: "Refunded. destination is the recorded payer.", ...errorContent },
      400: { description: "Address or Idempotency-Key rejected.", ...errorContent },
      401: { description: "Missing, invalid, or revoked key.", ...errorContent },
      403: { description: "Money disabled, missing money scope, or not the poster.", ...errorContent },
      409: { description: "Not refundable, or idempotency conflict.", ...errorContent },
      429: { description: "Per-key money limit (10/hour).", ...errorContent },
    },
  });
}
