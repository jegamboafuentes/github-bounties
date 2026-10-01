import { handleAdminGetSettings, handleAdminSetFee, handleAdminSetPool } from "@/admin/http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleAdminGetSettings(request);
}

export async function PUT(request: Request) {
  const body = (await request.clone().json().catch(() => null)) as { feeBps?: unknown; poolBps?: unknown } | null;
  if (body && "poolBps" in body && !("feeBps" in body)) return handleAdminSetPool(request);
  return handleAdminSetFee(request);
}

export function POST(request: Request) {
  return handleAdminSetFee(request);
}
