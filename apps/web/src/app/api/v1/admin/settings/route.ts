import { handleAdminGetSettings, handleAdminSetFee, handleAdminSetPool } from "@/admin/http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleAdminGetSettings(request);
}

export async function PUT(request: Request) {
  const body = (await request.clone().json().catch(() => null)) as {
    feeBps?: unknown;
    feePercent?: unknown;
    poolBps?: unknown;
    poolPercent?: unknown;
  } | null;
  const hasFee = Boolean(body && ("feeBps" in body || "feePercent" in body));
  const hasPool = Boolean(body && ("poolBps" in body || "poolPercent" in body));
  if (hasPool && !hasFee) return handleAdminSetPool(request);
  return handleAdminSetFee(request);
}

export function POST(request: Request) {
  return handleAdminSetFee(request);
}
