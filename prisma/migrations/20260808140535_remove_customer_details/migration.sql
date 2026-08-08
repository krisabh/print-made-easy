-- DropIndex
DROP INDEX "PrintJob_customerPhone_idx";

-- AlterTable
ALTER TABLE "PrintJob" DROP COLUMN "customerName",
DROP COLUMN "customerPhone";
