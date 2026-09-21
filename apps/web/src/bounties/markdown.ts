/**
 * Conservative GitHub-flavored markdown → safe HTML.
 * Escapes all raw HTML first, then emits a small tag whitelist.
 * Links/images must be http(s). javascript: and data: are dropped.
 */

export const ISSUE_BODY_MAX = 65_536;

const ATX_HEADING = /^(#{1,6})\s+(.+)$/;
const FENCE = /^```([\w.+-]*)\s*$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/;
const UL = /^[-*+]\s+(.+)$/;
const OL = /^(\d+)\.\s+(.+)$/;
const BLOCKQUOTE = /^>\s?(.*)$/;

export function clipIssueBody(value: string | null, max = ISSUE_BODY_MAX): string | null {
  if (!value) return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function looksLegacyClippedBody(snapshot: string, legacyMax = 4000): boolean {
  return snapshot.endsWith("…") && snapshot.length === legacyMax;
}

export function isSafeHref(raw: string): boolean {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function isSafeImgSrc(raw: string): boolean {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSafeIssueHtml(markdown: string): string {
  const source = markdown.replace(/\r\n/g, "\n").slice(0, ISSUE_BODY_MAX);
  const lines = source.split("\n");
  const html: string[] = [];
  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${inline(paragraph.join("\n"))}</p>`);
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (FENCE.test(trimmed)) {
      flushParagraph();
      const lang = trimmed.match(FENCE)?.[1] ?? "";
      const fenceLines: string[] = [];
      i += 1;
      while (i < lines.length && !FENCE.test((lines[i] ?? "").trim())) {
        fenceLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) i += 1;
      const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
      html.push(`<pre><code${langAttr}>${escapeHtml(fenceLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      i += 1;
      continue;
    }

    if (HR.test(trimmed)) {
      flushParagraph();
      html.push("<hr />");
      i += 1;
      continue;
    }

    const heading = trimmed.match(ATX_HEADING);
    if (heading) {
      flushParagraph();
      const level = heading[1]?.length ?? 1;
      html.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      i += 1;
      continue;
    }

    const quote = line.match(BLOCKQUOTE);
    if (quote) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length) {
        const q = (lines[i] ?? "").match(BLOCKQUOTE);
        if (!q) break;
        quoted.push(q[1] ?? "");
        i += 1;
      }
      html.push(`<blockquote>${inline(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    const ul = trimmed.match(UL);
    const ol = trimmed.match(OL);
    if (ul || ol) {
      flushParagraph();
      const ordered = Boolean(ol);
      const items: string[] = [];
      const re = ordered ? OL : UL;
      while (i < lines.length) {
        const item = (lines[i] ?? "").trim().match(re);
        if (!item) break;
        items.push(`<li>${inline(ordered ? (item[2] ?? "") : (item[1] ?? ""))}</li>`);
        i += 1;
      }
      html.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return html.join("");
}

function inline(value: string): string {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, href: string) => {
    const decoded = unescapeAttr(href);
    if (!isSafeImgSrc(decoded)) return "";
    return `<img src="${escapeHtml(decoded)}" alt="" />`;
  });
  text = text.replace(/\[([^\]]+)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label: string, href: string) => {
    const decoded = unescapeAttr(href);
    if (!isSafeHref(decoded)) return label;
    return `<a href="${escapeHtml(decoded)}" rel="noreferrer noopener" target="_blank">${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return text.replace(/\n/g, "<br />");
}

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
