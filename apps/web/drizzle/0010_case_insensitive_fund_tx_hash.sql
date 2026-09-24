-- Case-insensitive fund transaction hashes (security follow-up to 0009).
--
-- 0009 unique indexes compare fund_tx_hash as raw text, so 0xAbC and 0xabc
-- can both be stored. This migration replaces:
--   bounty_contributions_fund_tx_hash_uidx
--   escrows_fund_tx_hash_uidx
-- with unique indexes on lower(fund_tx_hash). 0009 did not index any other
-- hash column.
--
-- This migration does not UPDATE existing rows. If two rows would collide
-- under lower(), it aborts and leaves the 0009 indexes in place. Do not
-- lowercase stored hashes in this migration.
--
-- Ops: run the pre-check on DEV and PROD before `migrate 0010`. A row means
-- stop. See docs/security/README.md.
--
-- PRE-CHECK (read-only) — count of case-insensitive duplicate groups:
-- SELECT source, count(*) AS duplicate_groups
-- FROM (
--   SELECT 'bounty_contributions' AS source
--   FROM bounty_contributions
--   WHERE fund_tx_hash IS NOT NULL
--   GROUP BY lower(fund_tx_hash)
--   HAVING count(*) > 1
--   UNION ALL
--   SELECT 'escrows' AS source
--   FROM escrows
--   WHERE fund_tx_hash IS NOT NULL
--   GROUP BY lower(fund_tx_hash)
--   HAVING count(*) > 1
-- ) d
-- GROUP BY source;
--
-- Detail (read-only), when the count is not zero:
-- SELECT 'bounty_contributions' AS source,
--   lower(fund_tx_hash) AS fund_tx_hash_lower,
--   count(*) AS n,
--   array_agg(DISTINCT fund_tx_hash ORDER BY fund_tx_hash) AS variants,
--   array_agg(bounty_id ORDER BY bounty_id) AS bounty_ids
-- FROM bounty_contributions
-- WHERE fund_tx_hash IS NOT NULL
-- GROUP BY lower(fund_tx_hash)
-- HAVING count(*) > 1
-- UNION ALL
-- SELECT 'escrows' AS source,
--   lower(fund_tx_hash) AS fund_tx_hash_lower,
--   count(*) AS n,
--   array_agg(DISTINCT fund_tx_hash ORDER BY fund_tx_hash) AS variants,
--   array_agg(bounty_id ORDER BY bounty_id) AS bounty_ids
-- FROM escrows
-- WHERE fund_tx_hash IS NOT NULL
-- GROUP BY lower(fund_tx_hash)
-- HAVING count(*) > 1;

DO $$
DECLARE
  contrib_dups text;
  escrow_dups text;
BEGIN
  SELECT string_agg(
    format('lower(fund_tx_hash)=%s n=%s variants=%s bounty_ids=%s', fund_tx_hash_lower, n, variants, bounty_ids),
    E'\n' ORDER BY fund_tx_hash_lower
  )
  INTO contrib_dups
  FROM (
    SELECT lower(fund_tx_hash) AS fund_tx_hash_lower,
      count(*) AS n,
      string_agg(DISTINCT fund_tx_hash, ',' ORDER BY fund_tx_hash) AS variants,
      string_agg(bounty_id::text, ',' ORDER BY bounty_id::text) AS bounty_ids
    FROM bounty_contributions
    WHERE fund_tx_hash IS NOT NULL
    GROUP BY lower(fund_tx_hash)
    HAVING count(*) > 1
  ) d;

  SELECT string_agg(
    format('lower(fund_tx_hash)=%s n=%s variants=%s bounty_ids=%s', fund_tx_hash_lower, n, variants, bounty_ids),
    E'\n' ORDER BY fund_tx_hash_lower
  )
  INTO escrow_dups
  FROM (
    SELECT lower(fund_tx_hash) AS fund_tx_hash_lower,
      count(*) AS n,
      string_agg(DISTINCT fund_tx_hash, ',' ORDER BY fund_tx_hash) AS variants,
      string_agg(bounty_id::text, ',' ORDER BY bounty_id::text) AS bounty_ids
    FROM escrows
    WHERE fund_tx_hash IS NOT NULL
    GROUP BY lower(fund_tx_hash)
    HAVING count(*) > 1
  ) d;

  IF contrib_dups IS NOT NULL OR escrow_dups IS NOT NULL THEN
    RAISE EXCEPTION
      E'0010 refused to replace fund_tx_hash unique indexes because case-insensitive duplicates already exist. This migration does not rewrite hashes. Clean the collisions, then migrate again.\n-- bounty_contributions --\n%\n-- escrows --\n%',
      coalesce(contrib_dups, '(none)'),
      coalesce(escrow_dups, '(none)');
  END IF;

  EXECUTE 'DROP INDEX IF EXISTS "bounty_contributions_fund_tx_hash_uidx"';
  EXECUTE 'DROP INDEX IF EXISTS "escrows_fund_tx_hash_uidx"';
  EXECUTE 'CREATE UNIQUE INDEX "bounty_contributions_fund_tx_hash_uidx" ON "bounty_contributions" (lower("fund_tx_hash")) WHERE "fund_tx_hash" IS NOT NULL';
  EXECUTE 'CREATE UNIQUE INDEX "escrows_fund_tx_hash_uidx" ON "escrows" (lower("fund_tx_hash")) WHERE "fund_tx_hash" IS NOT NULL';
END $$;
