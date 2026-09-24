import { BASE_MAINNET_CAIP2 } from "../lib/constants";
import { usdcToAtomic } from "../lib/money";
import type { MoneyAction } from "./actor-log";
import type { EnvMap } from "./env";
import { isMainnetAllowed } from "./env";
import { EscrowError } from "./errors";
import {
  assertFacilitatorSettlementMatches,
  readX402Requirement,
  type FacilitatorSettlementCheck,
} from "./fund-hash";
import {
  logX402PaidFailure,
  x402DollarPrice,
  x402FailureFromChallenge,
  x402NetworkCaip2,
  x402ResourceUrl,
  x402UsdcAsset,
  x402UsdcEip712Extra,
} from "./x402";

export type X402SellerChallenge = {
  status: 402;
  headers: Record<string, string>;
  body?: unknown;
};

export type X402SellerSettled = {
  status: 200;
  headers: Record<string, string>;
  txHash: string;
  payer?: string;
  network?: string;
  body?: unknown;
  /** Passed to the rail when this settle also locks or tops up. Already checked. */
  facilitatorSettlement?: FacilitatorSettlementCheck;
};

export type X402SellerError = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type X402SellerResult =
  | { kind: "challenge"; challenge: X402SellerChallenge }
  | { kind: "settled"; settled: X402SellerSettled }
  | { kind: "error"; error: X402SellerError };

type LooseAdapter = {
  getHeader(name: string): string | undefined;
  getMethod(): string;
  getPath(): string;
  getUrl(): string;
  getAcceptHeader(): string;
  getUserAgent(): string;
};

type ProcessResult = {
  type: string;
  response?: { status: number; headers: Record<string, string>; body?: unknown };
  paymentPayload?: unknown;
  paymentRequirements?: unknown;
  declaredExtensions?: Record<string, unknown>;
  beforeHandlerSettlement?: {
    transaction?: string;
    payer?: string;
    network?: string;
    amount?: string;
    requirements?: unknown;
  };
};

type HttpServer = {
  initialize(): Promise<void>;
  processHTTPRequest(context: {
    adapter: LooseAdapter;
    path: string;
    method: string;
    paymentHeader?: string;
  }): Promise<ProcessResult>;
  processSettlement(
    paymentPayload: unknown,
    requirements: unknown,
    declaredExtensions?: Record<string, unknown>,
    transportContext?: { request: { adapter: LooseAdapter; path: string; method: string } },
    settlementOverrides?: undefined,
    beforeHandlerSettlement?: ProcessResult["beforeHandlerSettlement"],
  ): Promise<{
    success: boolean;
    transaction?: string;
    payer?: string;
    network?: string;
    amount?: string;
    errorReason?: string;
    errorMessage?: string;
    headers?: Record<string, string>;
    requirements?: unknown;
  }>;
};

export function requestToAdapter(req: Request, paymentHeader?: string): LooseAdapter {
  const url = new URL(req.url);
  return {
    getHeader(name) {
      const fromReq = req.headers.get(name) ?? undefined;
      if (fromReq) return fromReq;
      const lower = name.toLowerCase();
      if (
        paymentHeader &&
        (lower === "payment-signature" || lower === "x-payment")
      ) {
        return paymentHeader;
      }
      return undefined;
    },
    getMethod() {
      return req.method;
    },
    getPath() {
      return url.pathname;
    },
    getUrl() {
      return req.url;
    },
    getAcceptHeader() {
      return req.headers.get("accept") ?? "";
    },
    getUserAgent() {
      return req.headers.get("user-agent") ?? "";
    },
  };
}

/**
 * Live seller network: same gate as the rail. Mainnet only when
 * `CDP_ALLOW_MAINNET` is truthy. DEV stays Base Sepolia.
 */
export function x402SellerNetworkCaip2(network: string, env: EnvMap = process.env) {
  const caip2 = x402NetworkCaip2(network);
  if (caip2 === BASE_MAINNET_CAIP2 && !isMainnetAllowed(env)) {
    throw new EscrowError(
      "mainnet_refused",
      "x402 exact seller refuses Base mainnet unless this is an explicit prod go-live (CDP_ALLOW_MAINNET=1). DEV uses Base Sepolia.",
      { details: { network } },
    );
  }
  return caip2;
}

/**
 * Live x402 `exact` seller via CDP facilitator + @x402/core HTTP server.
 * payTo is gb-escrow (passed in). Dynamic-imports so unit tests never load the SDK.
 */
export async function processLiveX402Exact(input: {
  req: Request;
  bountyId: string;
  faceUsdc: string;
  payTo: string;
  network: string;
  paymentHeader?: string;
  env?: EnvMap;
  description?: string;
  actorUserId?: string | null;
  moneyAction?: MoneyAction;
}): Promise<X402SellerResult> {
  const caip2 = x402SellerNetworkCaip2(input.network, input.env);

  let createCdpFacilitatorClient: () => unknown;
  type ResourceServer = {
    register(network: string, scheme: unknown): ResourceServer;
    initialize(): Promise<void>;
  };
  let x402ResourceServer: new (facilitator: unknown) => ResourceServer;
  let x402HTTPResourceServer: new (server: unknown, routes: unknown) => HttpServer;
  let ExactEvmScheme: new () => unknown;
  try {
    ({ createCdpFacilitatorClient } = (await import("@coinbase/cdp-sdk/x402")) as {
      createCdpFacilitatorClient: () => unknown;
    });
    ({ x402ResourceServer, x402HTTPResourceServer } = (await import("@x402/core/server")) as {
      x402ResourceServer: typeof x402ResourceServer;
      x402HTTPResourceServer: typeof x402HTTPResourceServer;
    });
    ({ ExactEvmScheme } = (await import("@x402/evm/exact/server")) as {
      ExactEvmScheme: new () => unknown;
    });
  } catch (err) {
    throw new EscrowError(
      "x402_facilitator_unavailable",
      err instanceof Error
        ? `x402 seller packages failed to load: ${err.message}`
        : "x402 seller packages failed to load.",
    );
  }

  const path = new URL(input.req.url).pathname;
  const price = x402DollarPrice(input.faceUsdc);
  const extra = x402UsdcEip712Extra(input.network);
  const route = {
    accepts: {
      scheme: "exact" as const,
      network: caip2,
      payTo: input.payTo,
      price,
      extra,
    },
    description:
      input.description ??
      `GitHub Bounties fund lock: exact face to gb-escrow (${input.bountyId})`,
    mimeType: "application/json",
  };
  const routes = {
    [`GET ${path}`]: route,
    [`POST ${path}`]: route,
  };

  let httpServer: HttpServer;
  try {
    const facilitator = createCdpFacilitatorClient();
    const resourceServer = new x402ResourceServer(facilitator).register(
      caip2,
      new ExactEvmScheme(),
    );
    await resourceServer.initialize();
    httpServer = new x402HTTPResourceServer(resourceServer, routes);
    await httpServer.initialize();
  } catch (err) {
    throw new EscrowError(
      "x402_facilitator_unavailable",
      err instanceof Error
        ? `CDP x402 facilitator init failed: ${err.message}`
        : "CDP x402 facilitator init failed.",
    );
  }

  const adapter = requestToAdapter(input.req, input.paymentHeader);
  const processed = await httpServer.processHTTPRequest({
    adapter,
    path,
    method: input.req.method,
    paymentHeader: input.paymentHeader,
  });

  if (processed.type === "payment-error" && processed.response) {
    const failure = x402FailureFromChallenge({
      body: processed.response.body,
      headers: processed.response.headers,
    });
    if (input.paymentHeader && processed.response.status === 402) {
      logX402PaidFailure("x402_paid_post_rechallenged", {
        bountyId: input.bountyId,
        status: 402,
        processType: processed.type,
        network: caip2,
        errorReason: failure.errorReason,
        errorMessage: failure.errorMessage,
      });
      return {
        kind: "error",
        error: {
          status: 400,
          headers: processed.response.headers ?? { "cache-control": "no-store" },
          body: {
            ok: false,
            error: "facilitator_rechallenge",
            message: `Signed payment was re-challenged (${failure.errorReason}). Do not mark funded.`,
            errorReason: failure.errorReason,
            errorMessage: failure.errorMessage,
          },
        },
      };
    }
    if (processed.response.status === 402) {
      return { kind: "challenge", challenge: { ...processed.response, status: 402 } };
    }
    logX402PaidFailure("x402_process_http_error", {
      bountyId: input.bountyId,
      status: processed.response.status || 400,
      processType: processed.type,
      network: caip2,
      errorReason: failure.errorReason,
      errorMessage: failure.errorMessage,
    });
    return {
      kind: "error",
      error: {
        status: processed.response.status || 400,
        headers: processed.response.headers ?? {},
        body: processed.response.body,
      },
    };
  }

  if (processed.type !== "payment-verified") {
    return {
      kind: "error",
      error: {
        status: 400,
        headers: { "cache-control": "no-store" },
        body: {
          ok: false,
          error: "x402_payment_invalid",
          message: `Unexpected x402 process result: ${processed.type}`,
        },
      },
    };
  }

  const prior = processed.beforeHandlerSettlement;
  let txHash = prior?.transaction?.trim() ?? "";
  let payer = prior?.payer;
  let network = prior?.network;
  let headers: Record<string, string> = { "cache-control": "no-store" };

  if (!txHash || processed.type === "payment-verified") {
    const settled = await httpServer.processSettlement(
      processed.paymentPayload,
      processed.paymentRequirements,
      processed.declaredExtensions,
      { request: { adapter, path, method: input.req.method } },
      undefined,
      prior,
    );
    if (!settled.success) {
      const failure = x402FailureFromChallenge({
        headers: settled.headers,
        errorReason: settled.errorReason,
        errorMessage: settled.errorMessage,
      });
      logX402PaidFailure("x402_facilitator_settle_failed", {
        bountyId: input.bountyId,
        status: 400,
        network: caip2,
        errorReason: failure.errorReason,
        errorMessage: failure.errorMessage,
      });
      return {
        kind: "error",
        error: {
          status: 400,
          headers: settled.headers ?? { "cache-control": "no-store" },
          body: {
            ok: false,
            error: "x402_settle_failed",
            message:
              settled.errorMessage ||
              settled.errorReason ||
              "x402 exact settle failed. Do not mark funded.",
            errorReason: failure.errorReason,
            errorMessage: failure.errorMessage,
          },
        },
      };
    }
    txHash = (settled.transaction?.trim() || txHash).toLowerCase();
    payer = settled.payer ?? payer;
    network = settled.network ?? network;
    headers = { ...headers, ...(settled.headers ?? {}) };

    const issued = {
      network: caip2,
      payTo: input.payTo,
      asset: x402UsdcAsset(input.network),
      amount: usdcToAtomic(input.faceUsdc).toString(),
    };
    const requirements = readX402Requirement(settled.requirements ?? processed.paymentRequirements);
    const accepted = readX402Requirement(
      processed.paymentPayload && typeof processed.paymentPayload === "object"
        ? (processed.paymentPayload as { accepted?: unknown }).accepted
        : null,
    );
    const facilitatorSettlement: FacilitatorSettlementCheck = {
      bountyId: input.bountyId,
      actorUserId: input.actorUserId ?? null,
      requestId: input.req.headers.get("x-request-id"),
      action: input.moneyAction ?? "lock",
      txHash,
      issued,
      observed: {
        network: settled.network ?? network,
        payTo: requirements?.payTo,
        asset: requirements?.asset,
        amount: requirements?.amount,
        settledAmount: settled.amount,
        accepted,
      },
    };
    assertFacilitatorSettlementMatches(facilitatorSettlement);

    if (!txHash) {
      throw new EscrowError(
        "x402_settle_failed",
        "x402 exact settlement returned no transaction hash. Do not mark funded.",
      );
    }

    return {
      kind: "settled",
      settled: {
        status: 200,
        headers,
        txHash,
        payer,
        network,
        facilitatorSettlement,
        body: {
          ok: true,
          inbound: "recorded",
          fundTxHash: txHash,
          resource: x402ResourceUrl(input.bountyId, new URL(input.req.url).origin),
        },
      },
    };
  }

  throw new EscrowError(
    "x402_settle_failed",
    "x402 exact settlement returned no facilitator settle response. Do not mark funded.",
  );
}
