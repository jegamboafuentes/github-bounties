import { handleV1Get } from "@/api/access/http";
import { publicCorsPreflight } from "@/api/public/cors";
import { methodNotAllowed } from "@/api/public/methods";
import { acceptBountyId } from "@/api/public/query";
import { publicReadApi } from "@/api/public/service";

export const dynamic = "force-dynamic";

export function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleV1Get(request, async () => {
    const { id } = await ctx.params;
    return Response.json(await publicReadApi.getBounty(acceptBountyId(id)));
  });
}

export function OPTIONS() {
  return publicCorsPreflight();
}

export function POST() {
  return methodNotAllowed();
}

export function PUT() {
  return methodNotAllowed();
}

export function PATCH() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
