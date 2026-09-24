import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ASSET_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
};

/** Files Swagger UI loads from the same origin. No CDN. */
const ALLOWED_ASSETS = new Set([
  "swagger-ui.css",
  "swagger-ui-bundle.js",
  "swagger-ui-bundle.js.map",
  "favicon-32x32.png",
  "favicon-16x16.png",
]);

/**
 * Locate the published Swagger UI files.
 *
 * `require.resolve("swagger-ui-dist/...")` is rewritten by the Next server
 * bundle into a numeric module id, and `path.dirname` then throws. Walk the
 * filesystem from the process cwd and the server entry instead. That covers
 * `next start` (cwd `apps/web`) and the Cloud Run standalone image (cwd is
 * the directory of `server.js`, which traces this package into `node_modules`).
 */
export function swaggerUiDistDir(): string {
  const roots = [process.cwd(), path.dirname(process.argv[1] ?? "")];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!root || seen.has(root)) continue;
    seen.add(root);
    let dir = root;
    for (let depth = 0; depth < 5; depth += 1) {
      const candidate = path.join(/*turbopackIgnore: true*/ dir, "node_modules", "swagger-ui-dist");
      if (existsSync(/*turbopackIgnore: true*/ path.join(candidate, "package.json"))) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("swagger-ui-dist is not installed next to the server");
}

export async function readSwaggerAsset(name: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (!ALLOWED_ASSETS.has(name) || name.includes("/") || name.includes("\\")) return null;
  const file = path.join(/*turbopackIgnore: true*/ swaggerUiDistDir(), name);
  const body = await readFile(/*turbopackIgnore: true*/ file);
  const contentType = ASSET_TYPES[path.extname(name)] ?? "application/octet-stream";
  return { body, contentType };
}

/**
 * CSP allows the same-origin Swagger bundle (inline init + eval, which the
 * bundle uses) and Try it out against this host, DEV, and PROD.
 */
export const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' https://dev.githubbounties.xyz https://githubbounties.xyz",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function swaggerDocsHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GitHub Bounties API</title>
  <link rel="stylesheet" href="/api/docs/assets/swagger-ui.css" />
  <link rel="icon" type="image/png" href="/api/docs/assets/favicon-32x32.png" />
</head>
<body>
  <div id="swagger"></div>
  <script src="/api/docs/assets/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/v1/openapi.json",
      dom_id: "#swagger",
      deepLinking: true,
      persistAuthorization: true,
      presets: [SwaggerUIBundle.presets.apis],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>`;
}
