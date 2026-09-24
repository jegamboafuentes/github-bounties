import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PRODUCT_NAME } from "./constants";
import {
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  SITE_DESCRIPTION,
  buildSocialMetadata,
} from "./social-metadata";

function pngSize(relativePath: string): { width: number; height: number; bytes: number } {
  const file = fileURLToPath(new URL(relativePath, import.meta.url));
  const buf = readFileSync(file);
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length,
  };
}

describe("buildSocialMetadata", () => {
  it("emits absolute https og:image and twitter:image for DEV and PROD", () => {
    const dev = buildSocialMetadata({ PUBLIC_BASE_URL: "https://dev.githubbounties.xyz/" });
    const prod = buildSocialMetadata({ AUTH_URL: "https://githubbounties.xyz" });

    assert.equal(dev.metadataBase?.origin, "https://dev.githubbounties.xyz");
    assert.equal(prod.metadataBase?.origin, "https://githubbounties.xyz");

    const devImage = Array.isArray(dev.openGraph?.images) ? dev.openGraph.images[0] : undefined;
    const prodImage = Array.isArray(prod.openGraph?.images) ? prod.openGraph.images[0] : undefined;
    assert.ok(devImage && typeof devImage !== "string");
    assert.ok(prodImage && typeof prodImage !== "string");
    assert.equal(devImage.url, "https://dev.githubbounties.xyz/og.png");
    assert.equal(prodImage.url, "https://githubbounties.xyz/og.png");
    assert.equal(devImage.width, OG_IMAGE_WIDTH);
    assert.equal(devImage.height, OG_IMAGE_HEIGHT);
    assert.equal(devImage.alt, PRODUCT_NAME);

    assert.equal(dev.openGraph?.url, "https://dev.githubbounties.xyz/");
    assert.equal(dev.openGraph?.title, PRODUCT_NAME);
    assert.equal(dev.openGraph?.description, SITE_DESCRIPTION);
    assert.equal(dev.openGraph?.siteName, PRODUCT_NAME);
    assert.equal(dev.openGraph?.type, "website");
    assert.equal(dev.twitter?.card, "summary_large_image");
    assert.equal(dev.twitter?.title, PRODUCT_NAME);
    assert.equal(dev.twitter?.description, SITE_DESCRIPTION);
    assert.deepEqual(dev.twitter?.images, ["https://dev.githubbounties.xyz/og.png"]);
    assert.deepEqual(prod.twitter?.images, ["https://githubbounties.xyz/og.png"]);
  });

  it("uses the request host when PUBLIC_BASE_URL and AUTH_URL are unset", () => {
    const meta = buildSocialMetadata({}, { host: "dev.githubbounties.xyz", proto: "https" });
    const image = Array.isArray(meta.openGraph?.images) ? meta.openGraph.images[0] : undefined;
    assert.ok(image && typeof image !== "string");
    assert.equal(image.url, "https://dev.githubbounties.xyz/og.png");
  });
});

describe("share and icon assets", () => {
  it("serves a 1200×630 wordmark card under the WhatsApp size budget", () => {
    const og = pngSize("../../public/og.png");
    assert.equal(og.width, 1200);
    assert.equal(og.height, 630);
    assert.ok(og.bytes < 300_000, `og.png is ${og.bytes} bytes`);
  });

  it("uses a square wordmark icon for the tab and apple touch", () => {
    const icon = pngSize("../../public/icon.png");
    const apple = pngSize("../../public/apple-touch-icon.png");
    assert.equal(icon.width, 512);
    assert.equal(icon.height, 512);
    assert.equal(apple.width, 180);
    assert.equal(apple.height, 180);
    assert.equal(pngSize("../../src/app/icon.png").width, 512);
    assert.equal(pngSize("../../src/app/apple-icon.png").width, 180);
  });
});
