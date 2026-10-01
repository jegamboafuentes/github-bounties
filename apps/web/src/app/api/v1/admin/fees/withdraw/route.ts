import { handleAdminWithdraw, handleAdminWithdrawPreview } from "@/admin/http";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.endsWith("/preview")) return handleAdminWithdrawPreview(request);
  return handleAdminWithdraw(request);
}
