import { handlePublicRead } from "@/api/public/http";
import { acceptListInput, coerceListSearchParams } from "@/api/public/query";
import { publicReadApi } from "@/api/public/service";
import { publicCorsPreflight } from "@/api/public/cors";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handlePublicRead(
    request,
    async () => {
      const input = acceptListInput(coerceListSearchParams(new URL(request.url).searchParams));
      return Response.json(await publicReadApi.listBounties(input));
    },
    { cors: true },
  );
}

export function OPTIONS() {
  return publicCorsPreflight();
}
