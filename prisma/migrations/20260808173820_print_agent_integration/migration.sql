-- AlterTable
ALTER TABLE "Shop" ADD COLUMN "agentId" TEXT;
ALTER TABLE "Shop" ADD COLUMN "agentTokenHash" TEXT;
ALTER TABLE "Shop" ADD COLUMN "agentLastSeen" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PrintJob" ADD COLUMN "printAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PrintJob" ADD COLUMN "lastError" TEXT;

-- AlterTable
ALTER TABLE "PrintJobFile" ADD COLUMN "fileDeletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Shop_agentId_idx" ON "Shop"("agentId");

-- CreateIndex
CREATE INDEX "PrintJob_shopId_status_idx" ON "PrintJob"("shopId", "status");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "Printer_shopId_printerName_key" ON "Printer"("shopId", "printerName");