import { handleV1Action, handleV1Get } from "@/api/access/http";
import { publicCorsPreflight } from "@/api/public/cors";
import { methodNotAllowed } from "@/api/public/methods";
import { acceptListInput, coerceListSearchParams } from "@/api/public/query";
import { publicReadApi } from "@/api/public/service";

export const dynamic = "force-dynamic";

const WRITE_ALLOW = "GET, POST, OPTIONS";

export function GET(request: Request) {
  return handleV1Get(request, async () => {
    const input = acceptListInput(coerceListSearchParams(new URL(request.url).searchParams));
    return Response.json(await publicReadApi.listBounties(input));
  });
}

export function OPTIONS() {
  return publicCorsPreflight();
}

export function POST(request: Request) {
  return handleV1Action(request, { kind: "create" });
}

export function PUT() {
  return methodNotAllowed(WRITE_ALLOW);
}

export function PATCH() {
  return methodNotAllowed(WRITE_ALLOW);
}

export function DELETE() {
  return methodNotAllowed(WRITE_ALLOW);
}
