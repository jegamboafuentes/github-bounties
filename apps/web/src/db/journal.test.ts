import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const drizzleDir = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

type JournalEntry = { idx: number; when: number; tag: string };

/**
 * Drizzle applies a migration only when its journal `when` is greater than the
 * last applied timestamp. A hand-set `when` that is not strictly after the
 * previous entry is skipped on staging and PROD.
 */
describe("drizzle migration journal", () => {
  it("keeps when strictly increasing, idx contiguous, and tags matched to SQL files", () => {
    const journal = JSON.parse(readFileSync(join(drizzleDir, "meta/_journal.json"), "utf8")) as {
      entries: JournalEntry[];
    };
    const entries = journal.entries;
    assert.ok(entries.length > 0, "journal has no entries");

    const sqlFiles = readdirSync(drizzleDir).filter((name) => name.endsWith(".sql"));
    const tags = new Set<string>();
    const idxs = new Set<number>();

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      assert.ok(entry, `missing entry at position ${i}`);
      assert.equal(entry.idx, i, `${entry.tag} idx ${entry.idx} is not contiguous`);
      assert.equal(idxs.has(entry.idx), false, `duplicate idx ${entry.idx}`);
      idxs.add(entry.idx);
      if (i > 0) {
        const previous = entries[i - 1];
        assert.ok(previous);
        assert.ok(
          entry.when > previous.when,
          `${entry.tag} when ${entry.when} is not strictly after ${previous.tag} when ${previous.when}`,
        );
      }
      assert.equal(tags.has(entry.tag), false, `duplicate tag ${entry.tag}`);
      tags.add(entry.tag);
      assert.equal(sqlFiles.includes(`${entry.tag}.sql`), true, `missing SQL file for ${entry.tag}`);
    }

    for (const file of sqlFiles) {
      const tag = file.slice(0, -".sql".length);
      assert.equal(tags.has(tag), true, `SQL file ${file} has no journal entry`);
    }
  });
});
