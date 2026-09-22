/**
 * Branded transactional email. HTML is table-based for client support.
 * Logo is the existing public asset `/brand/logo-1.png` (dark mark on a light ground).
 * Later funded / merge / settled / pool-claimable events call these primitives.
 * This module does not send mail and does not read GitHub.
 */

import { DEV_EMAIL_BASE_URL, normalizeHttpBaseUrl } from "./env";
import { PRODUCT_NAME } from "../lib/constants";

export type EmailContent = {
  subject: string;
  html: string;
  text: string;
};

export type EmailCta = {
  label: string;
  href: string;
};

const RECIPIENT_FOOTNOTE =
  "You received this because you signed in to GitHub Bounties. We email only the address on that signed-in account. We do not use scraped GitHub addresses.";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function oneLine(value: string, max = 80): string {
  const collapsed = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

function resolveBaseUrl(baseUrl: string | null | undefined): string {
  return normalizeHttpBaseUrl(baseUrl) ?? DEV_EMAIL_BASE_URL;
}

function safeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function renderMessage(args: {
  baseUrl: string;
  subject: string;
  preheader: string;
  paragraphs: string[];
  cta?: EmailCta;
}): EmailContent {
  const baseUrl = resolveBaseUrl(args.baseUrl);
  const logoUrl = `${baseUrl}/brand/logo-1.png`;
  const paragraphs = args.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean);
  const ctaHref = args.cta ? safeHttpUrl(args.cta.href) : null;
  const safeCta = args.cta && ctaHref ? { label: args.cta.label, href: ctaHref } : null;

  const htmlParagraphs = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#18181b;">${escapeHtml(paragraph)}</p>`,
    )
    .join("");
  const ctaHtml = safeCta
    ? `<p style="margin:24px 0 0;"><a href="${escapeHtml(safeCta.href)}" style="display:inline-block;background:#18181b;color:#fafafa;text-decoration:none;font-size:15px;font-weight:600;padding:12px 18px;border-radius:8px;">${escapeHtml(safeCta.label)}</a></p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(args.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(args.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <img src="${escapeHtml(logoUrl)}" width="220" alt="${escapeHtml(PRODUCT_NAME)}" style="display:block;width:220px;max-width:100%;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              ${htmlParagraphs}
              ${ctaHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;font-size:12px;line-height:1.5;color:#71717a;">
              ${escapeHtml(RECIPIENT_FOOTNOTE)}
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
    ...paragraphs,
    "",
    ...(safeCta ? [`${safeCta.label}: ${safeCta.href}`, ""] : []),
    RECIPIENT_FOOTNOTE,
  ].join("\n");

  return { subject: args.subject, html, text };
}

export function renderWelcomeEmail(input: {
  displayName: string;
  baseUrl: string;
}): EmailContent {
  const name = input.displayName.trim() || "there";
  const baseUrl = resolveBaseUrl(input.baseUrl);
  return renderMessage({
    baseUrl,
    subject: "Welcome to GitHub Bounties",
    preheader: "Your Google sign-in is on file. Merge is truth.",
    paragraphs: [
      `Welcome, ${name}.`,
      "Your Google sign-in is on file, even if you have not posted or hunted a bounty yet.",
      "Post a USDC bounty on a GitHub issue, or hunt an open one. Merge is truth: the winner is the author of the merged pull request that closes the funded issue.",
    ],
    cta: { label: "Browse open bounties", href: `${baseUrl}/board` },
  });
}

export type BountyEmailInput = {
  baseUrl: string;
  displayName: string;
  bountyTitle: string;
  bountyUrl: string;
  amountUsdc?: string | null;
};

function bountyLead(input: BountyEmailInput): { name: string; title: string } {
  const name = input.displayName.trim() || "there";
  const title = oneLine(input.bountyTitle, 120) || "a bounty";
  return { name, title };
}

function normalizeLink(value: string): string | null {
  return safeHttpUrl(value);
}

function amountClause(amountUsdc: string | null | undefined): string {
  const amount = amountUsdc?.trim();
  if (!amount) return "";
  return ` (${oneLine(amount, 32)} USDC)`;
}

/** Not wired to fund events in this slice. */
export function renderBountyFundedEmail(input: BountyEmailInput): EmailContent {
  const { name, title } = bountyLead(input);
  const href = normalizeLink(input.bountyUrl);
  const baseUrl = resolveBaseUrl(input.baseUrl);
  return renderMessage({
    baseUrl,
    subject: `Bounty funded — ${oneLine(title)}`,
    preheader: `${title} is funded.`,
    paragraphs: [
      `${name}, a bounty is funded${amountClause(input.amountUsdc)}.`,
      title,
      "Hunters can work in parallel. Merge is still truth.",
    ],
    cta: href ? { label: "View bounty", href } : { label: "Open GitHub Bounties", href: baseUrl },
  });
}

/** Not wired to merge events in this slice. */
export function renderBountyMergedEmail(
  input: BountyEmailInput & { winnerLogin?: string | null },
): EmailContent {
  const { name, title } = bountyLead(input);
  const href = normalizeLink(input.bountyUrl);
  const winner = input.winnerLogin?.trim();
  const baseUrl = resolveBaseUrl(input.baseUrl);
  return renderMessage({
    baseUrl,
    subject: `Bounty merged — ${oneLine(title)}`,
    preheader: "A merged pull request closed a funded issue.",
    paragraphs: [
      `${name}, a merged pull request closed a funded issue.`,
      title,
      winner
        ? `Winner login on the merge: ${oneLine(winner, 40)}.`
        : "The winner is the author of that merged pull request.",
    ],
    cta: href ? { label: "View bounty", href } : { label: "Open GitHub Bounties", href: baseUrl },
  });
}

/** Not wired to settlement events in this slice. */
export function renderBountySettledEmail(input: BountyEmailInput): EmailContent {
  const { name, title } = bountyLead(input);
  const href = normalizeLink(input.bountyUrl);
  const baseUrl = resolveBaseUrl(input.baseUrl);
  return renderMessage({
    baseUrl,
    subject: `Bounty settled — ${oneLine(title)}`,
    preheader: "Settlement finished for a funded bounty.",
    paragraphs: [
      `${name}, settlement finished${amountClause(input.amountUsdc)}.`,
      title,
      "This note is not a payment instruction. On-chain settlement is unchanged.",
    ],
    cta: href ? { label: "View bounty", href } : { label: "Open GitHub Bounties", href: baseUrl },
  });
}

/** Not wired to pool Claim events in this slice. Manual pool Claim behavior is unchanged. */
export function renderPoolClaimableEmail(
  input: BountyEmailInput & { shareUsdc?: string | null },
): EmailContent {
  const { name, title } = bountyLead(input);
  const href = normalizeLink(input.bountyUrl);
  const share = input.shareUsdc?.trim();
  const baseUrl = resolveBaseUrl(input.baseUrl);
  return renderMessage({
    baseUrl,
    subject: `Pool share ready — ${oneLine(title)}`,
    preheader: "A pool share can be claimed by the signed-in hunter.",
    paragraphs: [
      `${name}, a pool share is ready to claim${share ? ` (${oneLine(share, 32)} USDC)` : ""}.`,
      title,
      "Each pool member still claims their own share. This note does not move USDC.",
    ],
    cta: href ? { label: "View bounty", href } : { label: "Open GitHub Bounties", href: baseUrl },
  });
}
