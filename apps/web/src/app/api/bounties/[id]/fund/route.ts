import { getCurrentPublicUser } from "@/auth/protect";
import { fundBounty, isBountyError } from "@/bounties";
import { getRuntimeDb } from "@/db/runtime";
import {
  escrowErrorJson,
  getEscrowSnapshot,
  httpStatusForEscrowCode,
  isEscrowError,
  jsonForUnknown,
} from "@/escrow";

export const dynamic = "force-dynamic";

/**
 * Poster Lock (pending_fund → funded). Client/rail failures are 4xx with
 * `error` + `message` (also persisted as escrows.fail_code / fail_reason).
 * Never 200 with a swallowed reason.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentPublicUser();
  if (!user) {
    return Response.json(
      {
        ok: false,
        error: "unauthorized",
        message: "Sign in with Google to fund a bounty.",
        fail_code: "unauthorized",
        fail_reason: "Sign in with Google to fund a bounty.",
      },
      { status: 401 },
    );
  }
  const { id } = await ctx.params;
  let fundTxHash: string | undefined;
  try {
    const body = (await req.json()) as { fundTxHash?: string };
    fundTxHash = body.fundTxHash;
  } catch {
    fundTxHash = undefined;
  }

  try {
    const funded = await fundBounty(id, user.id, getRuntimeDb(), new Date(), {
      fundTxHash,
    });
    const escrow = await getEscrowSnapshot(id, getRuntimeDb());
    return Response.json(
      { ok: true, ...funded, escrow },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const escrow = await getEscrowSnapshot(id, getRuntimeDb()).catch(() => null);
    if (isEscrowError(err)) {
      return Response.json(
        { ...escrowErrorJson(err), escrow },
        { status: httpStatusForEscrowCode(err.code) },
      );
    }
    if (isBountyError(err)) {
      const status =
        err.code === "unauthorized" ? 401 : err.code === "bounty_not_found" ? 404 : 400;
      return Response.json(
        {
          ok: false,
          error: err.code,
          message: err.message,
          fail_code: err.code,
          fail_reason: err.message,
          escrow,
        },
        { status },
      );
    }
    return Response.json(
      {
        ...jsonForUnknown(err instanceof Error ? err.message : "fund failed"),
        escrow,
      },
      { status: 500 },
    );
  }
}
