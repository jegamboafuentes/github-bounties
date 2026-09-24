import { publicCorsPreflight } from "@/api/public/cors";
import { handlePublicRead } from "@/api/public/http";
import { publicReadApi } from "@/api/public/service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handlePublicRead(request, async () => Response.json(await publicReadApi.getStats()), {
    cors: true,
  });
}

export function OPTIONS() {
  return publicCorsPreflight();
}
