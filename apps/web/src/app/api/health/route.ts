import { escrowHealth } from "@/escrow";
import { CLAIM_LOCK_HOURS, FEE_BPS, PRODUCT_NAME } from "@/lib/constants";

export function GET() {
  return Response.json(
    {
      ok: true,
      service: "github-bounties-web",
      product: PRODUCT_NAME,
      fee_bps: FEE_BPS,
      claim_lock_hours: CLAIM_LOCK_HOURS,
      escrow: escrowHealth(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
