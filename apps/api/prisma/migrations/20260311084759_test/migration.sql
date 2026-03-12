-- AlterTable
ALTER TABLE "Sheet" ADD COLUMN     "authTag" TEXT,
ADD COLUMN     "ciphertext" TEXT,
ADD COLUMN     "ephemeralPublicKey" TEXT,
ADD COLUMN     "iv" TEXT,
ALTER COLUMN "elements" DROP NOT NULL,
ALTER COLUMN "elements" DROP DEFAULT,
ALTER COLUMN "appState" DROP NOT NULL,
ALTER COLUMN "appState" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "encryptedPrivateKey" TEXT,
ADD COLUMN     "publicKey" TEXT;
