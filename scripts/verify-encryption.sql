-- ============================================================
-- DrawPro — Verify Client-Controlled Encryption at Rest
-- Run against the drawpro database to confirm sheets are
-- being encrypted before storage.
--
-- Usage (local Docker):
--   docker exec -i drawpro-postgres psql -U drawpro -d drawpro \
--     < scripts/verify-encryption.sql
-- ============================================================

-- ── 1. Summary: how many sheets are encrypted vs plaintext ──────────────────

SELECT
  COUNT(*)                                                   AS total_sheets,
  COUNT(*) FILTER (WHERE ciphertext IS NOT NULL)             AS encrypted,
  COUNT(*) FILTER (WHERE ciphertext IS NULL AND elements IS NOT NULL) AS plaintext,
  COUNT(*) FILTER (WHERE ciphertext IS NULL AND elements IS NULL)     AS empty_new
FROM "Sheet";

-- ── 2. Per-sheet status with a ciphertext preview ───────────────────────────

SELECT
  s.id,
  s.name,
  CASE
    WHEN s.ciphertext IS NOT NULL THEN 'ENCRYPTED'
    WHEN s.elements   IS NOT NULL THEN 'PLAINTEXT'
    ELSE                               'EMPTY'
  END                                     AS status,
  s.version,
  LEFT(s.ciphertext, 40)                  AS ciphertext_preview,   -- should be random base64
  LEFT(s.iv, 24)                          AS iv_preview,
  LEFT(s.ephemeral_public_key, 24)        AS epk_preview,
  LEFT(s.elements::text, 60)             AS elements_preview,      -- should be NULL when encrypted
  s.updated_at
FROM "Sheet" s
ORDER BY s.updated_at DESC;

-- ── 3. Users who have encryption keys configured ────────────────────────────

SELECT
  id,
  email,
  CASE WHEN public_key IS NOT NULL THEN 'YES' ELSE 'NO' END  AS encryption_enabled,
  LEFT(public_key, 24)                                        AS public_key_preview,
  CASE WHEN encrypted_private_key IS NOT NULL THEN 'YES' ELSE 'NO' END AS has_passcode_key,
  CASE WHEN recovery_encrypted_private_key IS NOT NULL THEN 'YES' ELSE 'NO' END AS has_recovery_key,
  created_at
FROM "User"
ORDER BY created_at DESC;

-- ── 4. Sanity: encrypted sheet names must be the sentinel '[encrypted]' ──────

SELECT id, name
FROM "Sheet"
WHERE ciphertext IS NOT NULL AND name != '[encrypted]';
-- Expected: 0 rows
-- If any rows returned, a sheet was encrypted but its name was not replaced with the sentinel.

-- ── 5. Sanity: encrypted sheets must never have plaintext elements ───────────

SELECT COUNT(*) AS bad_rows
FROM "Sheet"
WHERE ciphertext IS NOT NULL
  AND elements IS NOT NULL;
-- Expected: 0
-- If > 0, something is wrong — the API is storing both ciphertext and plaintext simultaneously.

-- ── 5. Sanity: all encrypted sheets must have all 4 encrypted fields ─────────

SELECT id, name
FROM "Sheet"
WHERE (ciphertext IS NOT NULL OR iv IS NOT NULL OR auth_tag IS NOT NULL OR ephemeral_public_key IS NOT NULL)
  AND NOT (
    ciphertext         IS NOT NULL AND
    iv                 IS NOT NULL AND
    auth_tag           IS NOT NULL AND
    ephemeral_public_key IS NOT NULL
  );
-- Expected: 0 rows
-- If any rows returned, those sheets have partially-written encrypted fields.
