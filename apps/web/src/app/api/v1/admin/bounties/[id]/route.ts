import { adminNotFoundResponse } from "@/admin/gate";
import { handleAdminDeleteBounty } from "@/admin/http";
import { isUuid } from "@/ids";

export const dynamic = "force-dynamic";

export function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => {
    if (!isUuid(id)) return adminNotFoundResponse();
    return handleAdminDeleteBounty(request, id);
  });
}
