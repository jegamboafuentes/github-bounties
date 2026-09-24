import { publicCorsPreflight } from "@/api/public/cors";
import { handlePublicRead } from "@/api/public/http";
import { acceptBountyId } from "@/api/public/query";
import { publicReadApi } from "@/api/public/service";

export const dynamic = "force-dynamic";

/** Cache read only. This route does not import the Gemini client. */
export function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handlePublicRead(
    request,
    async () => {
      const { id } = await ctx.params;
      return Response.json(await publicReadApi.getIntelligence(acceptBountyId(id)));
    },
    { cors: true },
  );
}

export function OPTIONS() {
  return publicCorsPreflight();
}
