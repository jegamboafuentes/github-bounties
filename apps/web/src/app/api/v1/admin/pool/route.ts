import { handleAdminSetPool } from "@/admin/http";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleAdminSetPool(request);
}
