import { publicCorsPreflight } from "@/api/public/cors";
import { handlePublicRead } from "@/api/public/http";
import { methodNotAllowed } from "@/api/public/methods";
import { acceptBountyId } from "@/api/public/query";
import { publicReadApi } from "@/api/public/service";

export const dynamic = "force-dynamic";

export function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handlePublicRead(
    request,
    async () => {
      const { id } = await ctx.params;
      return Response.json(await publicReadApi.getBounty(acceptBountyId(id)));
    },
    { cors: true },
  );
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
