import { PRODUCT_NAME } from "../lib/constants";
import type { EmailOutboxPayload, EmailTemplateName } from "../db/schema";

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

export type RenderEmailInput = {
  displayName: string;
  origin: string;
  payload?: EmailOutboxPayload | null;
};

type TemplateCopy = {
  subject: string;
  preheader: string;
  headline: string;
  paragraphs: string[];
  ctaLabel: string;
  ctaHref: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHttpUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() || fallback;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return url.toString();
  } catch {
    return fallback;
  }
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function bountyBits(payload: EmailOutboxPayload | null | undefined, origin: string) {
  const title = payload?.bountyTitle?.trim() || "";
  const amount = payload?.amountLabel?.trim() || "";
  const repo = payload?.repoFullName?.trim() || "";
  const issue =
    typeof payload?.issueNumber === "number" && Number.isFinite(payload.issueNumber)
      ? `#${payload.issueNumber}`
      : "";
  const where = [repo, issue].filter(Boolean).join(" ");
  const href = safeHttpUrl(payload?.bountyUrl, origin);
  return { title, amount, where, href };
}

function copyFor(template: EmailTemplateName, input: RenderEmailInput): TemplateCopy {
  const origin = safeHttpUrl(input.origin, "https://dev.githubbounties.xyz");
  const name = input.displayName.trim() || "there";
  const bounty = bountyBits(input.payload, origin);
  const titleBit = bounty.title ? `: ${clip(bounty.title, 60)}` : "";

  switch (template) {
    case "welcome":
      return {
        subject: `Welcome to ${PRODUCT_NAME}`,
        preheader: "Your Google sign-in is the account we use.",
        headline: "You're in",
        paragraphs: [
          `Hi ${name} — your Google sign-in is the account for ${PRODUCT_NAME}.`,
          "Connect GitHub from Settings when you want to post or hunt. Merge is truth: the author of the merged pull request that closes a funded issue is the winner.",
        ],
        ctaLabel: `Open ${PRODUCT_NAME}`,
        ctaHref: origin,
      };
    case "bounty_funded":
      return {
        subject: `Bounty funded${titleBit}`,
        preheader: "A bounty you can act on was funded.",
        headline: "Bounty funded",
        paragraphs: [
          `Hi ${name} — a bounty is funded${bounty.title ? ` (${bounty.title})` : ""}${bounty.amount ? ` for ${bounty.amount}` : ""}${bounty.where ? ` on ${bounty.where}` : ""}.`,
          "This note is ready for a later funded event. Opening the bounty does not move USDC by itself.",
        ],
        ctaLabel: "View bounty",
        ctaHref: bounty.href,
      };
    case "pr_merged":
      return {
        subject: `Pull request merged${titleBit}`,
        preheader: "Merge is the winner signal.",
        headline: "Pull request merged",
        paragraphs: [
          `Hi ${name} — a pull request merged${bounty.title ? ` on ${bounty.title}` : ""}${bounty.where ? ` (${bounty.where})` : ""}.`,
          "Merge is truth. This template does not settle or pay anyone.",
        ],
        ctaLabel: "View bounty",
        ctaHref: bounty.href,
      };
    case "bounty_settled":
      return {
        subject: `Bounty settled${titleBit}`,
        preheader: "Settlement finished for this bounty.",
        headline: "Bounty settled",
        paragraphs: [
          `Hi ${name} — settlement finished${bounty.title ? ` for ${bounty.title}` : ""}${bounty.amount ? ` (${bounty.amount})` : ""}.`,
          "Pool members still Claim their own share when one is waiting. This template does not submit a payout.",
        ],
        ctaLabel: "View bounty",
        ctaHref: bounty.href,
      };
    case "pool_claimable":
      return {
        subject: `Pool share ready to Claim${titleBit}`,
        preheader: "Manual pool Claim is unchanged.",
        headline: "Your pool share is ready",
        paragraphs: [
          `Hi ${name} — your participation-pool share is ready to Claim${bounty.title ? ` on ${bounty.title}` : ""}${bounty.amount ? ` (${bounty.amount})` : ""}.`,
          "Manual pool Claim is unchanged. Open the bounty and Claim your own share. Nothing in this email moves USDC.",
        ],
        ctaLabel: "Claim your share",
        ctaHref: bounty.href,
      };
  }
}

function layout(copy: TemplateCopy, origin: string): RenderedEmail {
  const logoUrl = `${origin}/logo-wordmark.png`;
  const paragraphsHtml = copy.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.5;color:#18181b;">${escapeHtml(paragraph)}</p>`,
    )
    .join("");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <img src="${escapeHtml(logoUrl)}" width="220" alt="${escapeHtml(PRODUCT_NAME)}" style="display:block;width:220px;max-width:100%;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0;">
              <h1 style="margin:0 0 12px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:22px;line-height:1.3;color:#09090b;">${escapeHtml(copy.headline)}</h1>
              ${paragraphsHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 28px 24px;">
              <a href="${escapeHtml(copy.ctaHref)}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;font-weight:600;line-height:1;padding:12px 18px;border-radius:8px;">${escapeHtml(copy.ctaLabel)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:13px;line-height:1.5;color:#71717a;">
              You received this because you signed up for ${escapeHtml(PRODUCT_NAME)} with Google.
              We only email that signup address — never a private address scraped from GitHub.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    PRODUCT_NAME,
    "",
    copy.headline,
    "",
    ...copy.paragraphs,
    "",
    `${copy.ctaLabel}: ${copy.ctaHref}`,
    "",
    `You received this because you signed up for ${PRODUCT_NAME} with Google.`,
    "We only email that signup address — never a private address scraped from GitHub.",
  ].join("\n");

  return { subject: copy.subject, html, text };
}

/** Branded HTML + plain text for one template. Does not send. */
export function renderEmail(template: EmailTemplateName, input: RenderEmailInput): RenderedEmail {
  const origin = safeHttpUrl(input.origin, "https://dev.githubbounties.xyz");
  const parsed = new URL(origin);
  return layout(copyFor(template, input), parsed.origin);
}

export function welcomeIdempotencyKey(userId: string): string {
  return `welcome:${userId}`;
}
