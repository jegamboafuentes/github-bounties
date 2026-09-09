import { createPrivateKey, createSign } from "node:crypto";

/**
 * GitHub App JWT (RS256). Valid ~10 minutes.
 * https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export function signGitHubAppJwt(appId: string, privateKeyPem: string, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000) - 60;
  const expiresAt = issuedAt + 600;
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({ iat: issuedAt, exp: expiresAt, iss: appId }),
  );
  const data = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  const key = createPrivateKey(privateKeyPem);
  const signature = sign.sign(key, "base64url");
  return `${data}.${signature}`;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
