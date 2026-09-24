import { publicCorsPreflight } from "@/api/public/cors";
import { handlePublicRead } from "@/api/public/http";
import { methodNotAllowed } from "@/api/public/methods";
import { acceptListInput, coerceListSearchParams } from "@/api/public/query";
import { publicReadApi } from "@/api/public/service";

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
