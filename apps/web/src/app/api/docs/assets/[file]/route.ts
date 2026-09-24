import { readSwaggerAsset } from "@/api/public/swagger";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const asset = await readSwaggerAsset(file);
  if (!asset) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  return new Response(new Uint8Array(asset.body), {
    headers: {
      "content-type": asset.contentType,
      "cache-control": "public, max-age=3600",
    },
  });
}
