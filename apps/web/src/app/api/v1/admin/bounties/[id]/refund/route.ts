import { handleAdminRefundBounty } from "@/admin/http";

export const dynamic = "force-dynamic";

export function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => handleAdminRefundBounty(request, id));
}
