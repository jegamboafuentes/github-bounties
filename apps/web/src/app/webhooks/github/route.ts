import { webhooksModule } from "@/modules/webhooks";

/** Stub. V0-B HMAC handler is still `src/handler.ts` at the repo root. */
export function POST() {
  return Response.json(
    {
      ok: false,
      wired: webhooksModule.wired,
      error: "not_implemented",
      ticket: webhooksModule.nextTicket,
    },
    { status: 501 },
  );
}
