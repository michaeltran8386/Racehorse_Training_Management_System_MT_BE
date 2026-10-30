-- Reconcile baseline + historical migrations to current schema.prisma
-- Resolves historical db-push drift (rfid deprecation and weightKg addition)

-- DropIndex
DROP INDEX IF EXISTS "Horse_rfid_idx";

-- DropIndex
DROP INDEX IF EXISTS "Horse_rfid_key";

-- AlterTable
ALTER TABLE "Horse" DROP COLUMN IF EXISTS "rfid",
ADD COLUMN IF NOT EXISTS "weightKg" DOUBLE PRECISION;
