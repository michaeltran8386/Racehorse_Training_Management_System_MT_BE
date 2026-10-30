-- Additive migration for TASK-018 / CR-024
-- Adds DELIVERING status to RestockStatus enum and nullable capacity column to StockBalance

-- AlterEnum: add DELIVERING to RestockStatus
ALTER TYPE "RestockStatus" ADD VALUE IF NOT EXISTS 'DELIVERING';

-- AlterTable: add nullable capacity to StockBalance
ALTER TABLE "StockBalance" ADD COLUMN IF NOT EXISTS "capacity" DECIMAL(12,2);
