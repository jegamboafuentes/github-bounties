import { getRuntimeDb } from "../db/runtime";
import { readBalanceSnapshot, balanceSnapshotJson } from "./balances";
import { softDeleteBounty } from "./delete";
import { isAdminError } from "./errors";
import { cdpNamedAccountClient } from "./fee-account";
import { adminNotFoundResponse, requireAdminApiActor } from "./gate";
import { readPlatformSettings, setPlatformFeeBps, setPlatformPoolBps } from "./settings";
import { executeFeeWithdraw, previewFeeWithdraw } from "./withdraw";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function fromError(err: unknown): Response {
  if (isAdminError(err)) {
    if (err.status === 404) return adminNotFoundResponse();
    return json({ error: err.code, message: err.message }, err.status);
  }
  const message = err instanceof Error ? err.message : "Admin request failed.";
  return json({ error: "admin_failed", message }, 500);
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
    return json({
      feeBps: settings.feeBps,
      poolBps: settings.poolBps,
      updatedAt: settings.updatedAt?.toISOString() ?? null,
      updatedBy: settings.updatedBy,
    });
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminSetFee(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as { feeBps?: unknown } | null;
  try {
    const settings = await setPlatformFeeBps(getRuntimeDb(), actor.email, body?.feeBps);
    return json({ feeBps: settings.feeBps, poolBps: settings.poolBps });
  } catch (err) {
    return fromError(err);
  }
}

export async function handleAdminSetPool(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  const body = (await request.json().catch(() => null)) as { poolBps?: unknown } | null;
  try {
    const settings = await setPlatformPoolBps(getRuntimeDb(), actor.email, body?.poolBps);
    return json({ feeBps: settings.feeBps, poolBps: settings.poolBps });
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

export async function handleAdminBalances(request: Request): Promise<Response> {
  const actor = await actorOr404(request);
  if (actor instanceof Response) return actor;
  try {
    const snapshot = await readBalanceSnapshot(getRuntimeDb(), await cdpNamedAccountClient(), process.env);
    return json(balanceSnapshotJson(snapshot));
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
