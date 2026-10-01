import { readPlatformSettings } from "@/admin/settings";
import { getRuntimeDb } from "@/db/runtime";
import { emailHealth } from "@/email/env";
import { escrowHealth } from "@/escrow";
import { intelligenceHealth } from "@/intelligence/env";
import { CLAIM_LOCK_HOURS, CLAIM_LOCK_SUNSET, FEE_BPS, PRODUCT_NAME } from "@/lib/constants";

export async function GET() {
  let feeBps = FEE_BPS;
  try {
    feeBps = (await readPlatformSettings(getRuntimeDb())).feeBps;
  } catch {
    feeBps = FEE_BPS;
  }
  return Response.json(
    {
      ok: true,
      service: "github-bounties-web",
      product: PRODUCT_NAME,
      fee_bps: feeBps,
      claim_lock_hours: CLAIM_LOCK_HOURS,
      claim_lock_sunset: CLAIM_LOCK_SUNSET,
      intelligence: intelligenceHealth(),
      email: emailHealth(),
      escrow: escrowHealth(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
