import type { Metadata } from "next";
import { PRODUCT_NAME } from "./constants";
import { readPublicSiteOrigin } from "./site-env";

/** Same product blurb the root layout has always used. */
export const SITE_DESCRIPTION =
  "USDC bounties on GitHub issues. 2% fee. Parallel hunt; optional Working on this.";

/**
 * Share card built from the header wordmark (`public/logo-wordmark.png`,
 * logo-1 / `public/brand/logo-1.png`). Dark scanline mark on `#fafafa`.
 * The whole mark sits in the center square: WhatsApp's bubble crops
 * `og:image` to 1:1. Not logo-3 (light mark, vanishes on a white thumb)
 * and not logo-6 (`logo-wordmark-on-dark.png`, for zinc-950 only).
 */
export const OG_IMAGE_PATH = "/og.png";
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export type SocialRequestHints = {
  host?: string | null;
  proto?: string | null;
};

/**
 * Root metadata for the browser tab and link unfurls (WhatsApp, Slack, X).
 *
 * Image URLs are absolute `https://…/og.png`. The origin is `PUBLIC_BASE_URL`,
 * then `AUTH_URL`, then the request host. Read this at request time: the
 * Cloud Run image is built without those vars, and DEV and PROD set them
 * differently (`https://dev.githubbounties.xyz` vs `https://githubbounties.xyz`).
 */
export function buildSocialMetadata(
  env: NodeJS.ProcessEnv = process.env,
  request?: SocialRequestHints,
): Metadata {
  const origin = readPublicSiteOrigin(env, request);
  const imageUrl = `${origin}${OG_IMAGE_PATH}`;
  const image = {
    url: imageUrl,
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    alt: PRODUCT_NAME,
    type: "image/png" as const,
  };

  return {
    metadataBase: new URL(origin),
    title: PRODUCT_NAME,
    description: SITE_DESCRIPTION,
    openGraph: {
      title: PRODUCT_NAME,
      description: SITE_DESCRIPTION,
      siteName: PRODUCT_NAME,
      type: "website",
      url: `${origin}/`,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: PRODUCT_NAME,
      description: SITE_DESCRIPTION,
      images: [imageUrl],
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "48x48" },
        { url: "/icon.png", type: "image/png", sizes: "512x512" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}
