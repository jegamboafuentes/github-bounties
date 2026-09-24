import { eq } from "drizzle-orm";
import { BountyError } from "../bounties/errors";
import { normalizeBountyAmountUsdc } from "../bounties/amount";
import type { Database } from "../db/client";
import { bounties, escrows } from "../db/schema";
import { EscrowError } from "./errors";
import { escrowErrorJson, httpStatusForEscrowCode } from "./http";
import { inboundIsRecorded, recordExactInbound } from "./inbound";
import { assertFundedTopUpOpen, topUpFundedBounty } from "./top-up";
import { hostedCheckoutStatus } from "./hosted";
import { resolveRail, type CdpRail } from "./rail";
import {
  buildX402ExactChallenge,
  encodePaymentRequiredHeader,
  extractPaymentHeader,
  logX402PaidFailure,
  publicOrigin,
  x402ChallengeResponseBody,
  x402FailureFromChallenge,
  x402ResourceUrl,
} from "./x402";
import { processLiveX402Exact } from "./x402-seller";

export type X402HttpResult = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type X402HandlerDeps = {
  db: Database;
  rail?: CdpRail;
  now?: Date;
  env?: NodeJS.ProcessEnv;
  liveSeller?: typeof processLiveX402Exact;
  /** Signed-in funder. Required only for `?topUpUsdc=` on an already-funded bounty. */
  actorUserId?: string | null;
};

function jsonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extra,
  };
}

function challengeResult(
  challenge: ReturnType<typeof buildX402ExactChallenge>,
  extras?: Record<string, unknown>,
): X402HttpResult {
  const encoded = encodePaymentRequiredHeader(challenge);
  return {
    status: 402,
    headers: jsonHeaders({
      "PAYMENT-REQUIRED": encoded,
    }),
    body: x402ChallengeResponseBody(challenge, {
      ok: false,
      error: "payment_required",
      hosted_checkout: hostedCheckoutStatus(),
      ...extras,
    }),
  };
}

/**
 * GET|POST /api/bounties/:id/x402
 *
 * Unpaid → 402 exact challenge (payTo = gb-escrow).
 * Paid → facilitator settle, record inbound, Lock may omit fundTxHash.
 * Already recorded / funded with no `topUpUsdc` → 200 (do not demand a second payment).
 * `?topUpUsdc=` on a funded bounty is another exact payment that increases face.
 */
export async function handleX402Fund(
  req: Request,
  bountyId: string,
  deps: X402HandlerDeps,
): Promise<X402HttpResult> {
  const env = deps.env ?? process.env;
  const origin = publicOrigin(env, new URL(req.url).origin);
  const resourceUrl = x402ResourceUrl(bountyId, origin);
  const paymentHeader = extractPaymentHeader((name) => req.headers.get(name));

  const [bounty] = await deps.db.select().from(bounties).where(eq(bounties.id, bountyId)).limit(1);
  if (!bounty) {
    return {
      status: 404,
      headers: jsonHeaders(),
      body: { ok: false, error: "bounty_not_found", message: "Bounty not found." },
    };
  }

  const [escrow] = await deps.db.select().from(escrows).where(eq(escrows.bountyId, bountyId)).limit(1);

  const topUpRaw = new URL(req.url).searchParams.get("topUpUsdc")?.trim() ?? "";
  if (bounty.status === "funded" && topUpRaw) {
    return handleFundedTopUp({
      req,
      bounty,
      deps,
      topUpRaw,
      paymentHeader,
      origin,
    });
  }

  if (bounty.status !== "pending_fund" && bounty.status !== "funded") {
    return {
      status: 400,
      headers: jsonHeaders(),
      body: {
        ok: false,
        error: "not_fundable",
        message: `Bounty is ${bounty.status}, not pending_fund.`,
      },
    };
  }

  if (escrow && (escrow.status === "funded" || bounty.status === "funded")) {
    return {
      status: 200,
      headers: jsonHeaders(),
      body: {
        ok: true,
        alreadyFunded: true,
        fundTxHash: escrow.fundTxHash,
        x402PaymentId: escrow.x402PaymentId,
        hosted_checkout: hostedCheckoutStatus(),
      },
    };
  }

  if (inboundIsRecorded(escrow)) {
    return {
      status: 200,
      headers: jsonHeaders(),
      body: {
        ok: true,
        inboundRecorded: true,
        fundTxHash: escrow?.fundTxHash,
        x402PaymentId: escrow?.x402PaymentId,
        message: "x402 exact inbound is recorded. Poster Lock in escrow — no hash paste.",
        hosted_checkout: hostedCheckoutStatus(),
      },
    };
  }

  let rail: CdpRail;
  try {
    rail = deps.rail ?? resolveRail(env);
  } catch (err) {
    if (err instanceof EscrowError) {
      return { status: 400, headers: jsonHeaders(), body: escrowErrorJson(err) };
    }
    throw err;
  }

  const wallets = await rail.ensureWallets();
  const challenge = buildX402ExactChallenge({
    bountyId,
    origin,
    payTo: wallets.escrowAddress,
    faceUsdc: bounty.amountUsdc,
    network: rail.network,
  });

  if (!paymentHeader) {
    return challengeResult(challenge, {
      payTo: wallets.escrowAddress,
      resourceUrl,
      rail: rail.mode,
    });
  }

  if (rail.mode !== "cdp") {
    return {
      status: 400,
      headers: jsonHeaders(),
      body: {
        ok: false,
        error: "x402_facilitator_unavailable",
        message:
          "Live CDP rail is required to settle x402 exact. Mock rail will not invent a fund hash. Use paste-hash Lock on mock, or bind CDP_* on DEV.",
        missing: rail.missingEnv,
        hosted_checkout: hostedCheckoutStatus(),
      },
    };
  }

  const liveSeller = deps.liveSeller ?? processLiveX402Exact;
  let live: Awaited<ReturnType<typeof processLiveX402Exact>>;
  try {
    live = await liveSeller({
      req,
      bountyId,
      faceUsdc: bounty.amountUsdc,
      payTo: wallets.escrowAddress,
      network: rail.network,
      paymentHeader,
      env,
    });
  } catch (err) {
    if (err instanceof EscrowError) {
      return { status: 400, headers: jsonHeaders(), body: escrowErrorJson(err) };
    }
    throw err;
  }

  if (live.kind === "challenge") {
    if (paymentHeader) {
      const failure = x402FailureFromChallenge({
        body: live.challenge.body,
        headers: live.challenge.headers,
      });
      logX402PaidFailure("x402_paid_post_rechallenged", {
        bountyId,
        status: 402,
        network: rail.network,
        errorReason: failure.errorReason,
        errorMessage: failure.errorMessage,
      });
      return {
        status: 400,
        headers: jsonHeaders(live.challenge.headers),
        body: {
          ok: false,
          error: "facilitator_rechallenge",
          message: `Signed payment was re-challenged (${failure.errorReason}). Do not mark funded.`,
          errorReason: failure.errorReason,
          errorMessage: failure.errorMessage,
          hosted_checkout: hostedCheckoutStatus(),
        },
      };
    }
    return {
      status: 402,
      headers: jsonHeaders(live.challenge.headers),
      body: live.challenge.body ?? challenge,
    };
  }
  if (live.kind === "error") {
    return {
      status: live.error.status || 400,
      headers: jsonHeaders(live.error.headers),
      body: live.error.body,
    };
  }

  const recorded = await recordExactInbound(deps.db, {
    bountyId,
    txHash: live.settled.txHash,
    x402PaymentId: live.settled.txHash.startsWith("0x")
      ? `x402:${live.settled.txHash}`
      : live.settled.txHash,
    escrowAddress: wallets.escrowAddress,
    resourceUrl,
    funderAddress: live.settled.payer,
    now: deps.now,
  });

  return {
    status: 200,
    headers: jsonHeaders(live.settled.headers),
    body: {
      ok: true,
      inboundRecorded: true,
      alreadyRecorded: recorded.alreadyRecorded,
      fundTxHash: recorded.txHash,
      payTo: wallets.escrowAddress,
      resource: resourceUrl,
      message: "x402 exact inbound recorded. Poster Lock in escrow — no hash paste.",
      hosted_checkout: hostedCheckoutStatus(),
    },
  };
}

/**
 * Second (or Nth) funder. Same exact challenge, price = the added amount.
 * Settle credits face immediately — there is no second pending Lock.
 */
async function handleFundedTopUp(input: {
  req: Request;
  bounty: typeof bounties.$inferSelect;
  deps: X402HandlerDeps;
  topUpRaw: string;
  paymentHeader: string | undefined;
  origin: string;
}): Promise<X402HttpResult> {
  const { req, bounty, deps, topUpRaw, paymentHeader, origin } = input;
  if (!deps.actorUserId) {
    return {
      status: 401,
      headers: jsonHeaders(),
      body: {
        ok: false,
        error: "unauthorized",
        message: "Sign in with Google to add USDC to this bounty.",
      },
    };
  }

  let amountUsdc: string;
  try {
    amountUsdc = normalizeBountyAmountUsdc(topUpRaw);
  } catch (err) {
    if (err instanceof BountyError) {
      return {
        status: 400,
        headers: jsonHeaders(),
        body: { ok: false, error: err.code, message: err.message },
      };
    }
    throw err;
  }

  try {
    await assertFundedTopUpOpen(deps.db, bounty.id);
  } catch (err) {
    if (err instanceof EscrowError) {
      return {
        status: httpStatusForEscrowCode(err.code),
        headers: jsonHeaders(),
        body: escrowErrorJson(err),
      };
    }
    throw err;
  }

  const env = deps.env ?? process.env;
  const resourceUrl = x402ResourceUrl(bounty.id, origin);
  let rail: CdpRail;
  try {
    rail = deps.rail ?? resolveRail(env);
  } catch (err) {
    if (err instanceof EscrowError) {
      return { status: 400, headers: jsonHeaders(), body: escrowErrorJson(err) };
    }
    throw err;
  }

  const wallets = await rail.ensureWallets();
  const description = `GitHub Bounties top-up: exact USDC to gb-escrow (bounty ${bounty.id})`;
  const challenge = buildX402ExactChallenge({
    bountyId: bounty.id,
    origin,
    payTo: wallets.escrowAddress,
    faceUsdc: amountUsdc,
    network: rail.network,
    description,
  });

  if (!paymentHeader) {
    return challengeResult(challenge, {
      payTo: wallets.escrowAddress,
      resourceUrl,
      rail: rail.mode,
      topUpUsdc: amountUsdc,
    });
  }

  if (rail.mode !== "cdp") {
    return {
      status: 400,
      headers: jsonHeaders(),
      body: {
        ok: false,
        error: "x402_facilitator_unavailable",
        message:
          "Live CDP rail is required to settle x402 exact. Mock rail will not invent a fund hash. Paste a top-up hash, or bind CDP_* on DEV.",
        missing: rail.missingEnv,
        hosted_checkout: hostedCheckoutStatus(),
      },
    };
  }

  const liveSeller = deps.liveSeller ?? processLiveX402Exact;
  let live: Awaited<ReturnType<typeof processLiveX402Exact>>;
  try {
    live = await liveSeller({
      req,
      bountyId: bounty.id,
      faceUsdc: amountUsdc,
      payTo: wallets.escrowAddress,
      network: rail.network,
      paymentHeader,
      env,
      description,
    });
  } catch (err) {
    if (err instanceof EscrowError) {
      return { status: 400, headers: jsonHeaders(), body: escrowErrorJson(err) };
    }
    throw err;
  }

  if (live.kind === "challenge") {
    const failure = x402FailureFromChallenge({
      body: live.challenge.body,
      headers: live.challenge.headers,
    });
    logX402PaidFailure("x402_paid_post_rechallenged", {
      bountyId: bounty.id,
      status: 402,
      network: rail.network,
      errorReason: failure.errorReason,
      errorMessage: failure.errorMessage,
    });
    return {
      status: 400,
      headers: jsonHeaders(live.challenge.headers),
      body: {
        ok: false,
        error: "facilitator_rechallenge",
        message: `Signed payment was re-challenged (${failure.errorReason}). Do not mark the top-up funded.`,
        errorReason: failure.errorReason,
        errorMessage: failure.errorMessage,
        hosted_checkout: hostedCheckoutStatus(),
      },
    };
  }
  if (live.kind === "error") {
    return {
      status: live.error.status || 400,
      headers: jsonHeaders(live.error.headers),
      body: live.error.body,
    };
  }

  try {
    const applied = await topUpFundedBounty(
      bounty.id,
      deps.actorUserId,
      {
        amountUsdc,
        fundTxHash: live.settled.txHash,
        funderAddress: live.settled.payer,
      },
      { db: deps.db, rail, now: deps.now },
    );
    return {
      status: 200,
      headers: jsonHeaders(live.settled.headers),
      body: {
        ok: true,
        topUpApplied: true,
        alreadyApplied: applied.alreadyApplied,
        amountUsdc: applied.amountUsdc,
        faceUsdc: applied.faceUsdc,
        fundTxHash: applied.fundTxHash,
        payTo: wallets.escrowAddress,
        resource: resourceUrl,
        message: applied.alreadyApplied
          ? "This top-up was already applied."
          : "Top-up added to escrow. Face, fee, and pool use the new total.",
        hosted_checkout: hostedCheckoutStatus(),
      },
    };
  } catch (err) {
    if (err instanceof EscrowError) {
      return {
        status: httpStatusForEscrowCode(err.code),
        headers: jsonHeaders(),
        body: escrowErrorJson(err),
      };
    }
    if (err instanceof BountyError) {
      return {
        status: 400,
        headers: jsonHeaders(),
        body: { ok: false, error: err.code, message: err.message },
      };
    }
    throw err;
  }
}
