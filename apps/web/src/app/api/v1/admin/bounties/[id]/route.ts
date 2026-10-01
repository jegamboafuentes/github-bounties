import { handleAdminDeleteBounty } from "@/admin/http";

export const dynamic = "force-dynamic";

export function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => handleAdminDeleteBounty(request, id));
}
