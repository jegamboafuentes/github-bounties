import { handleAdminBalances } from "@/admin/http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleAdminBalances(request);
}
