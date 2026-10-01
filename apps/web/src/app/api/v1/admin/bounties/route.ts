import { handleAdminListBounties } from "@/admin/http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleAdminListBounties(request);
}
