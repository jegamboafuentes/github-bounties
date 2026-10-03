/** RFC-style CSV. Quoted commas, quotes, and newlines are preserved. No contact data lives in git. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const char = src[i];
    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char ?? "";
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char === "\r") continue;
    cell += char ?? "";
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim().length > 0));
}

export function csvRecords(text: string): Record<string, string>[] {
  const table = parseCsv(text);
  const header = table[0]?.map((cell) => cell.trim()) ?? [];
  if (header.length === 0) return [];
  return table.slice(1).map((cols) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      if (!key) return;
      record[key] = (cols[index] ?? "").trim();
    });
    return record;
  });
}

/** Spreadsheet formula cells stay text. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map((cell) => csvCell(cell)).join(","));
  return `${lines.join("\n")}\n`;
}
