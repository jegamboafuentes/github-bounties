import { escrowHealth } from "@/escrow";
import { CLAIM_LOCK_HOURS, CLAIM_LOCK_SUNSET, FEE_BPS, PRODUCT_NAME } from "@/lib/constants";

export function GET() {
  return Response.json(
    {
      ok: true,
      service: "github-bounties-web",
      product: PRODUCT_NAME,
      fee_bps: FEE_BPS,
      claim_lock_hours: CLAIM_LOCK_HOURS,
      claim_lock_sunset: CLAIM_LOCK_SUNSET,
      escrow: escrowHealth(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
