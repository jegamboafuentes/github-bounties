-- Unique fund transaction hashes (security hotfix).
--
-- One confirmed USDC inbound can credit only one bounty. Partial unique indexes:
--   bounty_contributions(fund_tx_hash) WHERE fund_tx_hash IS NOT NULL
--   escrows(fund_tx_hash) WHERE fund_tx_hash IS NOT NULL
--
-- This migration does not create those indexes on top of existing duplicates
-- (that would fail with a generic unique-violation). It detects duplicates
-- first and aborts with a message that lists them. Ops: run the pre-check
-- on DEV and PROD before `migrate 0009`. If either query returns rows, clean
-- those hashes, then migrate.
--
-- PRE-CHECK (read-only):
-- SELECT fund_tx_hash, count(*) AS n, array_agg(bounty_id ORDER BY bounty_id) AS bounty_ids
-- FROM bounty_contributions
-- WHERE fund_tx_hash IS NOT NULL
-- GROUP BY fund_tx_hash
-- HAVING count(*) > 1;
--
-- SELECT fund_tx_hash, count(*) AS n, array_agg(bounty_id ORDER BY bounty_id) AS bounty_ids
-- FROM escrows
-- WHERE fund_tx_hash IS NOT NULL
-- GROUP BY fund_tx_hash
-- HAVING count(*) > 1;

DO $$
DECLARE
  contrib_dups text;
  escrow_dups text;
BEGIN
  SELECT string_agg(
    format('fund_tx_hash=%s bounty_ids=%s', fund_tx_hash, bounty_ids),
    E'\n' ORDER BY fund_tx_hash
  )
  INTO contrib_dups
  FROM (
    SELECT fund_tx_hash,
      string_agg(bounty_id::text, ',' ORDER BY bounty_id::text) AS bounty_ids
    FROM bounty_contributions
    WHERE fund_tx_hash IS NOT NULL
    GROUP BY fund_tx_hash
    HAVING count(*) > 1
  ) d;

  SELECT string_agg(
    format('fund_tx_hash=%s bounty_ids=%s', fund_tx_hash, bounty_ids),
    E'\n' ORDER BY fund_tx_hash
  )
  INTO escrow_dups
  FROM (
    SELECT fund_tx_hash,
      string_agg(bounty_id::text, ',' ORDER BY bounty_id::text) AS bounty_ids
    FROM escrows
    WHERE fund_tx_hash IS NOT NULL
    GROUP BY fund_tx_hash
    HAVING count(*) > 1
  ) d;

  IF contrib_dups IS NOT NULL OR escrow_dups IS NOT NULL THEN
    RAISE EXCEPTION
      E'0009 refused to create unique fund_tx_hash indexes because duplicates already exist. Clean them, then migrate again.\n-- bounty_contributions --\n%\n-- escrows --\n%',
      coalesce(contrib_dups, '(none)'),
      coalesce(escrow_dups, '(none)');
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bounty_contributions_fund_tx_hash_uidx" ON "bounty_contributions" ("fund_tx_hash") WHERE "fund_tx_hash" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "escrows_fund_tx_hash_uidx" ON "escrows" ("fund_tx_hash") WHERE "fund_tx_hash" IS NOT NULL;
