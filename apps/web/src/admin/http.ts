import { redactDatabaseText, redactPublicValue } from "../http/redact-error";
import { getRuntimeDb } from "../db/runtime";
import { balanceReportJson, readBalanceReport } from "./balances";
import { listAdminBounties } from "./bounties";
import { softDeleteBounty } from "./delete";
import { isAdminError } from "./errors";
import { cdpNamedAccountClient } from "./fee-account";
import { adminNotFoundResponse, requireAdminApiActor } from "./gate";
import { adminRefundBounty } from "./refund";
import { platformRatesJson, readPlatformSettings, setPlatformFee, setPlatformPool } from "./settings";
import { executeFeeWithdraw, previewFeeWithdraw } from "./withdraw";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function fromError(err: unknown): Response {
  if (isAdminError(err)) {
    if (err.status === 404) return adminNotFoundResponse();
    const message = redactDatabaseText(err.message);
    const body = err.details
      ? { error: err.code, message, details: redactPublicValue(err.details) }
      : { error: err.code, message };
    return json(body, err.status);
  }
  console.error(
    JSON.stringify({
      severity: "ERROR",
      event: "admin_action_failed",
      reason: err instanceof Error ? err.message : "Admin request failed.",
    }),
  );
  return json({ error: "admin_failed", message: "Admin request failed." }, 500);
}

async function actorOr404(request: Request) {
  const actor = await requireAdminApiActor(request);
  if (actor instanceof Response) return actor;
  return actor;
}

export async function handleAdminGetSettings(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  try {
    const settings = await readPlatformSettings(getRuntimeDb());
    return json(platformRatesJson(settings, { includeAudit: true }));
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminSetFee(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as { feeBps?: unknown; feePercent?: unknown } | null;
  try {
    const settings = await setPlatformFee(getRuntimeDb(), actor.email, {
      feeBps: body?.feeBps,
      feePercent: body?.feePercent,
    });
    return json(platformRatesJson(settings));
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminSetPool(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as { poolBps?: unknown; poolPercent?: unknown } | null;
  try {
    const settings = await setPlatformPool(getRuntimeDb(), actor.email, {
      poolBps: body?.poolBps,
      poolPercent: body?.poolPercent,
    });
    return json(platformRatesJson(settings));
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminDeleteBounty(request: Request, bountyId: string): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  try {
    const deleted = await softDeleteBounty({
      bountyId,
      actorEmail: actor.email,
      db: getRuntimeDb(),
    });
    return json({ id: deleted.id, deletedAt: deleted.deletedAt.toISOString() });
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminListBounties(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "");
  const offset = Number(url.searchParams.get("offset") ?? "");
  try {
    const page = await listAdminBounties(getRuntimeDb(), {
      search: url.searchParams.get("search") ?? url.searchParams.get("q") ?? "",
      status: url.searchParams.get("status"),
      limit: Number.isFinite(limit) && url.searchParams.has("limit") ? limit : undefined,
      offset: Number.isFinite(offset) && url.searchParams.has("offset") ? offset : undefined,
    });
    return json(page);
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminRefundBounty(request: Request, bountyId: string): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  try {
    const refunded = await adminRefundBounty({
      bountyId,
      actorEmail: actor.email,
      db: getRuntimeDb(),
      env: process.env,
    });
    return json(refunded);
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminBalances(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  try {
    const report = await readBalanceReport(getRuntimeDb(), process.env);
    return json(balanceReportJson(report));
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminWithdrawPreview(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as {
    amountUsdc?: string;
    destination?: string;
    network?: string;
  } | null;
  try {
    const preview = await previewFeeWithdraw({
      db: getRuntimeDb(),
      env: process.env,
      actorEmail: actor.email,
      amountUsdc: body?.amountUsdc ?? "",
      destination: body?.destination ?? "",
      callerNetwork: body?.network,
      client: await cdpNamedAccountClient(),
      readBalance: async (address) => {
        const { readOnChainUsdcBalance } = await import("./balances");
        return readOnChainUsdcBalance(address);
      },
    });
    return json(preview);
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminWithdraw(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as {
    confirmToken?: string;
    confirmation?: string;
    network?: string;
  } | null;
  try {
    const sent = await executeFeeWithdraw({
      db: getRuntimeDb(),
      env: process.env,
      actorEmail: actor.email,
      confirmToken: body?.confirmToken ?? "",
      confirmation: body?.confirmation ?? "",
      callerNetwork: body?.network,
      client: await cdpNamedAccountClient(),
      readBalance: async (address) => {
        const { readOnChainUsdcBalance } = await import("./balances");
        return readOnChainUsdcBalance(address);
      },
    });
    return json(sent);
  } catch (err) {
    return fromError(err);
  }
}
