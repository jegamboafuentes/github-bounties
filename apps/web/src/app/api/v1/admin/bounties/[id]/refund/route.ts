import { adminNotFoundResponse } from "@/admin/gate";
import { handleAdminRefundBounty } from "@/admin/http";
import { isUuid } from "@/ids";

export const dynamic = "force-dynamic";

export function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => {
    if (!isUuid(id)) return adminNotFoundResponse();
    return handleAdminRefundBounty(request, id);
  });
}
