import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
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

function readPng(relativePath: string): {
  width: number;
  height: number;
  bytes: number;
  rgb: (x: number, y: number) => [number, number, number];
} {
  const file = fileURLToPath(new URL(relativePath, import.meta.url));
  const buf = readFileSync(file);
  assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const chunk = buf.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      colorType = chunk[9] ?? 0;
      assert.equal(chunk[8], 8, `${relativePath} must be 8-bit`);
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + length;
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
  assert.ok(channels === 3 || channels === 4, `${relativePath} color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows: Buffer[] = [];
  let offset = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset] ?? 0;
    offset += 1;
    const row = Buffer.from(raw.subarray(offset, offset + stride));
    offset += stride;
    if (filter === 1 || filter === 3 || filter === 4) {
      for (let x = 0; x < stride; x += 1) {
        const left = x >= channels ? (row[x - channels] ?? 0) : 0;
        const up = prev[x] ?? 0;
        const upLeft = x >= channels ? (prev[x - channels] ?? 0) : 0;
        let pred = 0;
        if (filter === 1) pred = left;
        else if (filter === 3) pred = Math.floor((left + up) / 2);
        else {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        }
        row[x] = ((row[x] ?? 0) + pred) & 255;
      }
    } else if (filter === 2) {
      for (let x = 0; x < stride; x += 1) row[x] = ((row[x] ?? 0) + (prev[x] ?? 0)) & 255;
    } else if (filter !== 0) {
      assert.fail(`${relativePath} uses PNG filter ${filter}`);
    }
    rows.push(row);
    prev = row;
  }
  return {
    width,
    height,
    bytes: buf.length,
    rgb(x: number, y: number): [number, number, number] {
      const row = rows[y];
      assert.ok(row);
      const i = x * channels;
      const r = row[i] ?? 0;
      const g = row[i + 1] ?? r;
      const b = row[i + 2] ?? r;
      const a = channels === 4 ? (row[i + 3] ?? 255) : 255;
      const bg = 250;
      const alpha = a / 255;
      return [
        Math.round(r * alpha + bg * (1 - alpha)),
        Math.round(g * alpha + bg * (1 - alpha)),
        Math.round(b * alpha + bg * (1 - alpha)),
      ];
    },
  };
}

/** Dark logo-1 ink on #fafafa. logo-3 is light ink and fails this on a white card. */
function assertDarkMarkOnLight(relativePath: string, width: number, height: number): void {
  const png = readPng(relativePath);
  assert.equal(png.width, width);
  assert.equal(png.height, height);
  assert.ok(png.bytes < 300_000, `${relativePath} is ${png.bytes} bytes`);
  for (const [x, y] of [
    [0, 0],
    [png.width - 1, 0],
    [0, png.height - 1],
    [png.width - 1, png.height - 1],
  ] as const) {
    const [r, g, b] = png.rgb(x, y);
    assert.ok(r >= 245 && g >= 245 && b >= 245, `${relativePath} corner ${x},${y} is ${r},${g},${b}`);
  }
  let dark = 0;
  const step = Math.max(1, Math.floor(Math.min(png.width, png.height) / 200));
  let samples = 0;
  for (let y = 0; y < png.height; y += step) {
    for (let x = 0; x < png.width; x += step) {
      samples += 1;
      const [r, g, b] = png.rgb(x, y);
      if ((r + g + b) / 3 < 40) dark += 1;
    }
  }
  const ratio = dark / samples;
  assert.ok(ratio > 0.05, `${relativePath} dark-ink ratio ${ratio.toFixed(3)} (logo-3 on white is ~0)`);
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
  it("serves a 1200×630 dark wordmark on #fafafa under the WhatsApp size budget", () => {
    assertDarkMarkOnLight("../../public/og.png", OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT);
  });

  it("uses the same dark-on-light mark for the tab and apple touch", () => {
    assertDarkMarkOnLight("../../public/icon.png", 512, 512);
    assertDarkMarkOnLight("../../public/apple-touch-icon.png", 180, 180);
    assertDarkMarkOnLight("../../src/app/icon.png", 512, 512);
    assertDarkMarkOnLight("../../src/app/apple-icon.png", 180, 180);
  });

  it("ships public/og.png beside the standalone server", () => {
    const dockerfile = readFileSync(fileURLToPath(new URL("../../Dockerfile", import.meta.url)), "utf8");
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
    ) as { scripts: { build: string } };
    assert.match(pkg.scripts.build, /stage-standalone-public\.mjs/);
    const standaloneCopy = dockerfile.indexOf("/app/.next/standalone");
    const publicCopy = dockerfile.lastIndexOf("/app/public ./public");
    assert.ok(standaloneCopy > 0, "Dockerfile must copy the standalone server");
    assert.ok(publicCopy > standaloneCopy, "public/ must be copied after standalone so /og.png is at the image root");
  });
});
