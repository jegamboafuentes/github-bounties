-- Read-only audit for the 2026-09-24 escrow hotfix.
-- Every runnable statement is a SELECT. No UPDATE, DELETE, or INSERT.
-- The correction at the bottom is commented out and is not part of migrate 0009.
-- Run on PROD after QA smoke on DEV, and before migrate 0009.
-- An empty result is the healthy case for every query.

-- 1. Duplicate fund hashes.
-- If this returns rows, STOP: 0009 unique index will fail; do not hand-edit PROD data.
SELECT 'bounty_contributions' AS source, fund_tx_hash, count(*) AS n,
  array_agg(bounty_id ORDER BY bounty_id) AS bounty_ids
FROM bounty_contributions
WHERE fund_tx_hash IS NOT NULL
GROUP BY fund_tx_hash
HAVING count(*) > 1
UNION ALL
SELECT 'escrows' AS source, fund_tx_hash, count(*) AS n,
  array_agg(bounty_id ORDER BY bounty_id) AS bounty_ids
FROM escrows
WHERE fund_tx_hash IS NOT NULL
GROUP BY fund_tx_hash
HAVING count(*) > 1;

-- 2. Escrow fund hashes that are not an x402 settle and not a mock/dry-run rail hash.
--    x402 lock sets escrows.x402_payment_id. A 0x hash with no payment id was pasted.
SELECT
  e.bounty_id,
  b.status AS bounty_status,
  e.status AS escrow_status,
  e.fund_tx_hash,
  e.x402_payment_id,
  e.funder_address,
  e.amount_usdc
FROM escrows e
JOIN bounties b ON b.id = e.bounty_id
WHERE e.fund_tx_hash IS NOT NULL
  AND e.fund_tx_hash NOT LIKE 'mock:%'
  AND e.fund_tx_hash NOT LIKE 'sepolia-dry-run:%'
  AND (e.x402_payment_id IS NULL OR btrim(e.x402_payment_id) = '');

-- 3. Contribution hashes that are not the x402 lock hash, not an x402-topup line
--    on the escrow payment id, and not a mock/dry-run rail hash.
--    A real x402 top-up from before this deploy has no marker. After you confirm
--    that hash on Base, append a line `x402-topup:<hash>` to escrows.x402_payment_id
--    so Claim can count it. Do not mark a hash you cannot find on-chain.
SELECT
  c.bounty_id,
  c.id AS contribution_id,
  c.fund_tx_hash,
  c.amount_usdc,
  c.funder_user_id,
  c.funder_address,
  e.fund_tx_hash AS escrow_fund_tx_hash,
  e.x402_payment_id
FROM bounty_contributions c
LEFT JOIN escrows e ON e.bounty_id = c.bounty_id
WHERE c.fund_tx_hash NOT LIKE 'mock:%'
  AND c.fund_tx_hash NOT LIKE 'sepolia-dry-run:%'
  AND NOT (
    e.x402_payment_id IS NOT NULL
    AND (
      c.fund_tx_hash = e.fund_tx_hash
      OR e.x402_payment_id LIKE '%x402-topup:' || c.fund_tx_hash || '%'
    )
  );

-- 4. Claims whose payout address differs from the hunter's saved wallet.
SELECT
  c.id AS claim_id,
  c.bounty_id,
  c.status,
  c.hunter_user_id,
  c.payout_address,
  u.wallet_address AS saved_wallet
FROM claims c
JOIN users u ON u.id = c.hunter_user_id
WHERE c.payout_address IS NOT NULL
  AND u.wallet_address IS NOT NULL
  AND lower(btrim(c.payout_address)) <> lower(btrim(u.wallet_address));

-- 5. Winner payout legs whose address differs from the merge-flow claim.
SELECT
  l.bounty_id,
  l.to_address AS ledger_to_address,
  l.tx_hash,
  l.status AS ledger_status,
  c.id AS claim_id,
  c.hunter_user_id,
  c.payout_address AS claim_payout_address,
  c.status AS claim_status
FROM allocation_ledger l
JOIN claims c ON c.bounty_id = l.bounty_id AND c.status IN ('eligible', 'paid')
WHERE l.kind = 'WINNER_PAYOUT'
  AND l.to_address IS NOT NULL
  AND c.payout_address IS NOT NULL
  AND lower(btrim(l.to_address)) <> lower(btrim(c.payout_address));

-- 6. Frozen winner user does not match the merge-flow claim hunter.
SELECT
  p.bounty_id,
  p.user_id AS freeze_winner_user_id,
  c.hunter_user_id AS claim_hunter_user_id,
  c.status AS claim_status
FROM pool_participants p
JOIN claims c ON c.bounty_id = p.bounty_id AND c.status IN ('eligible', 'paid')
WHERE p.role = 'winner'
  AND p.frozen_at IS NOT NULL
  AND p.user_id IS NOT NULL
  AND p.user_id <> c.hunter_user_id;

-- 7. Refunded escrows whose recorded funder differs from the poster's saved wallet
--    and no x402 payer was stored. Single-funder refunds go to funder_address.
SELECT
  e.bounty_id,
  b.status AS bounty_status,
  e.status AS escrow_status,
  e.refund_tx_hash,
  e.funder_address,
  u.wallet_address AS poster_wallet,
  e.x402_payment_id
FROM escrows e
JOIN bounties b ON b.id = e.bounty_id
JOIN users u ON u.id = b.poster_user_id
WHERE e.refund_tx_hash IS NOT NULL
  AND e.funder_address IS NOT NULL
  AND (e.x402_payment_id IS NULL OR btrim(e.x402_payment_id) = '')
  AND u.wallet_address IS NOT NULL
  AND lower(btrim(e.funder_address)) <> lower(btrim(u.wallet_address));

-- 8. Contribution refunds whose funder address differs from that funder's saved wallet.
SELECT
  c.bounty_id,
  c.id AS contribution_id,
  c.refund_tx_hash,
  c.funder_address,
  u.wallet_address AS saved_wallet
FROM bounty_contributions c
JOIN users u ON u.id = c.funder_user_id
WHERE c.refund_tx_hash IS NOT NULL
  AND c.funder_address IS NOT NULL
  AND u.wallet_address IS NOT NULL
  AND lower(btrim(c.funder_address)) <> lower(btrim(u.wallet_address));

-- 9. Odd states: pending_fund with an escrow that already looks funded, or a funded
--    bounty whose escrow is still pending.
SELECT
  b.id AS bounty_id,
  b.status AS bounty_status,
  e.status AS escrow_status,
  e.fund_tx_hash,
  e.fail_code
FROM bounties b
LEFT JOIN escrows e ON e.bounty_id = b.id
WHERE (b.status = 'pending_fund' AND e.status IN ('funded', 'settling', 'settled', 'settled_partial', 'refunding', 'refunded'))
   OR (b.status = 'funded' AND (e.id IS NULL OR e.status = 'pending'));

-- 10. Contribution rows with no settled hash, or a placeholder hash from a failed
--     or incomplete fund (lock: / legacy-fund:), which can be left by a wallet
--     with no USDC.
SELECT
  c.bounty_id,
  c.id AS contribution_id,
  c.fund_tx_hash,
  c.amount_usdc,
  c.funder_user_id
FROM bounty_contributions c
WHERE c.fund_tx_hash IS NULL
   OR btrim(c.fund_tx_hash) = ''
   OR c.fund_tx_hash LIKE 'lock:%'
   OR c.fund_tx_hash LIKE 'legacy-fund:%';

-- 11. Escrows whose funder_address is the escrow wallet (x402 payTo), not the sender.
--     PROD example: bounty bbcc9ee5. Lock used to fall through to the escrow
--     address when the poster had no saved wallet, overwriting the x402 payer.
--     Report these rows. Do not edit them from this script.
SELECT
  e.bounty_id,
  b.status AS bounty_status,
  e.status AS escrow_status,
  e.funder_address,
  e.escrow_address,
  e.x402_payment_id,
  e.fund_tx_hash,
  c.funder_address AS contribution_funder_address,
  u.wallet_address AS poster_wallet
FROM escrows e
JOIN bounties b ON b.id = e.bounty_id
LEFT JOIN users u ON u.id = b.poster_user_id
LEFT JOIN bounty_contributions c
  ON c.bounty_id = e.bounty_id
 AND c.fund_tx_hash = e.fund_tx_hash
WHERE e.funder_address IS NOT NULL
  AND e.escrow_address IS NOT NULL
  AND lower(btrim(e.funder_address)) = lower(btrim(e.escrow_address));

-- CORRECTION — OWNER APPROVAL REQUIRED. DO NOT RUN.
-- Not part of migrate 0009. Every line below is commented out.
-- Sets funder_address from a stored payer that is not the escrow wallet,
-- and only when that payer still exists on the contribution row or the
-- poster's saved wallet. If Lock overwrote both (PROD bounty bbcc9ee5,
-- real sender 0x14f1…a15C), this matches zero rows. Do not invent an address.
--
-- UPDATE escrows e
-- SET funder_address = src.payer,
--     updated_at = now()
-- FROM (
--   SELECT e2.id,
--          COALESCE(
--            CASE
--              WHEN c.funder_address IS NOT NULL
--               AND lower(btrim(c.funder_address)) <> lower(btrim(e2.escrow_address))
--              THEN btrim(c.funder_address)
--            END,
--            CASE
--              WHEN u.wallet_address IS NOT NULL
--               AND lower(btrim(u.wallet_address)) <> lower(btrim(e2.escrow_address))
--              THEN btrim(u.wallet_address)
--            END
--          ) AS payer
--   FROM escrows e2
--   JOIN bounties b ON b.id = e2.bounty_id
--   LEFT JOIN users u ON u.id = b.poster_user_id
--   LEFT JOIN bounty_contributions c
--     ON c.bounty_id = e2.bounty_id
--    AND c.fund_tx_hash = e2.fund_tx_hash
--   WHERE e2.funder_address IS NOT NULL
--     AND e2.escrow_address IS NOT NULL
--     AND lower(btrim(e2.funder_address)) = lower(btrim(e2.escrow_address))
--     AND e2.x402_payment_id IS NOT NULL
--     AND btrim(e2.x402_payment_id) <> ''
-- ) src
-- WHERE e.id = src.id
--   AND src.payer IS NOT NULL;
