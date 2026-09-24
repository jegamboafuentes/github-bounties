/**
 * Next standalone does not copy `public/`. server.js only serves files that
 * exist in `<dir of server.js>/public` when the process boots.
 *
 * Cloud Run's Dockerfile copies that folder, but a parent lockfile can nest
 * server.js under `.next/standalone/apps/web/` while the image still drops
 * public/ at the image root — `/og.png` then 404s as the prerendered not-found
 * page even though other traced routes (and a previous image's public files)
 * keep working. Stage `public/` beside server.js and refuse a nested server.
 */
import { cpSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = path.join(appDir, ".next", "standalone");
const publicDir = path.join(appDir, "public");

const candidates = [
  path.join(standaloneDir, "server.js"),
  path.join(standaloneDir, "apps", "web", "server.js"),
];

const serverJs = candidates.find((file) => existsSync(file));
if (!serverJs) {
  console.error("standalone server.js not found. Expected one of:");
  for (const file of candidates) console.error("  " + file);
  process.exit(1);
}

const relativeServer = path.relative(standaloneDir, serverJs);
if (relativeServer !== "server.js") {
  console.error(
    `standalone server.js is nested at ${relativeServer}. ` +
      "The Cloud Run image copies public/ to the image root, so /og.png would 404. " +
      "Pin outputFileTracingRoot to the apps/web directory.",
  );
  process.exit(1);
}

cpSync(publicDir, path.join(path.dirname(serverJs), "public"), { recursive: true });

const ogPath = path.join(path.dirname(serverJs), "public", "og.png");
const og = readFileSync(ogPath);
if (og.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
  console.error("staged public/og.png is not a PNG");
  process.exit(1);
}
const width = og.readUInt32BE(16);
const height = og.readUInt32BE(20);
if (width !== 1200 || height !== 630) {
  console.error(`staged public/og.png is ${width}x${height}, expected 1200x630`);
  process.exit(1);
}

console.log(`staged public/ beside standalone/${relativeServer} (og.png ${width}x${height})`);
