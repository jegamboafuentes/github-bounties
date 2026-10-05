import { handleV1Action } from "@/api/access/http";
import { publicCorsPreflight } from "@/api/public/cors";
import { methodNotAllowed } from "@/api/public/methods";

export const dynamic = "force-dynamic";

const ALLOW = "GET, POST, DELETE, OPTIONS";

export function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => handleV1Action(request, { kind: "submissions", bountyId: id }));
}

export function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => handleV1Action(request, { kind: "submit-pr", bountyId: id }));
}

export function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return ctx.params.then(({ id }) => handleV1Action(request, { kind: "withdraw-submission", bountyId: id }));
}

export function OPTIONS() {
  return publicCorsPreflight();
}

export function PUT() {
  return methodNotAllowed(ALLOW);
}

export function PATCH() {
  return methodNotAllowed(ALLOW);
}
