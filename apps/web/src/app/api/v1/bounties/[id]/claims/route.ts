import { handleV1Action } from "@/api/access/http";
import { publicCorsPreflight } from "@/api/public/cors";
import { methodNotAllowed } from "@/api/public/methods";

export const dynamic = "force-dynamic";

const ALLOW = "GET, OPTIONS";

export function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => handleV1Action(request, { kind: "bounty-claims", bountyId: id }));
}

export function OPTIONS() {
  return publicCorsPreflight();
}

export function POST() {
  return methodNotAllowed(ALLOW);
}

export function PUT() {
  return methodNotAllowed(ALLOW);
}

export function PATCH() {
  return methodNotAllowed(ALLOW);
}

export function DELETE() {
  return methodNotAllowed(ALLOW);
}
