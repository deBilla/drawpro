-- Migration: okara_crypto_scheme
-- Replace old ECIES fields with new okara-crypto compatible schema

-- User: drop old recovery field, add salt + recoveryCodesData
ALTER TABLE "User" DROP COLUMN IF EXISTS "recoveryEncryptedPrivateKey";
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "salt" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryCodesData" TEXT;

-- Clear old-format keys so users re-setup with the new scheme
UPDATE "User" SET "publicKey" = NULL, "encryptedPrivateKey" = NULL
  WHERE "publicKey" IS NOT NULL;

-- Sheet: drop old 4-field ECIES columns, add single encryptedData blob
ALTER TABLE "Sheet" DROP COLUMN IF EXISTS "ciphertext";
ALTER TABLE "Sheet" DROP COLUMN IF EXISTS "iv";
ALTER TABLE "Sheet" DROP COLUMN IF EXISTS "authTag";
ALTER TABLE "Sheet" DROP COLUMN IF EXISTS "ephemeralPublicKey";
ALTER TABLE "Sheet" ADD COLUMN IF NOT EXISTS "encryptedData" TEXT;
