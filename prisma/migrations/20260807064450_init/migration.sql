-- CreateEnum
CREATE TYPE "PrintMode" AS ENUM ('BW', 'COLOR');

-- CreateEnum
CREATE TYPE "PrintType" AS ENUM ('SINGLE', 'DOUBLE');

-- CreateEnum
CREATE TYPE "PrintStatus" AS ENUM ('PENDING', 'PRINTING', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopCode" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT NOT NULL,
    "logo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintPrice" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "bwSingle" DECIMAL(10,2) NOT NULL,
    "bwDouble" DECIMAL(10,2) NOT NULL,
    "colorSingle" DECIMAL(10,2) NOT NULL,
    "colorDouble" DECIMAL(10,2) NOT NULL,
    "minimumCharge" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "printerName" TEXT NOT NULL,
    "printerModel" TEXT,
    "printerType" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "paperAvailable" INTEGER NOT NULL DEFAULT 0,
    "estimatedInkLevel" INTEGER NOT NULL DEFAULT 100,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "totalPages" INTEGER NOT NULL,
    "printMode" "PrintMode" NOT NULL,
    "printType" "PrintType" NOT NULL,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "status" "PrintStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintJobFile" (
    "id" TEXT NOT NULL,
    "printJobId" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "storedFileName" TEXT NOT NULL,
    "fileExtension" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "totalPages" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintJobFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "autoDeleteDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopCode_key" ON "Shop"("shopCode");

-- CreateIndex
CREATE UNIQUE INDEX "PrintPrice_shopId_key" ON "PrintPrice"("shopId");

-- CreateIndex
CREATE INDEX "Printer_shopId_idx" ON "Printer"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_shopId_key" ON "Inventory"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintJob_jobNumber_key" ON "PrintJob"("jobNumber");

-- CreateIndex
CREATE INDEX "PrintJob_customerPhone_idx" ON "PrintJob"("customerPhone");

-- CreateIndex
CREATE INDEX "PrintJob_status_idx" ON "PrintJob"("status");

-- CreateIndex
CREATE INDEX "PrintJob_createdAt_idx" ON "PrintJob"("createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_shopId_idx" ON "PrintJob"("shopId");

-- CreateIndex
CREATE INDEX "PrintJobFile_printJobId_idx" ON "PrintJobFile"("printJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Settings_shopId_key" ON "Settings"("shopId");

-- AddForeignKey
ALTER TABLE "PrintPrice" ADD CONSTRAINT "PrintPrice_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Printer" ADD CONSTRAINT "Printer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintJobFile" ADD CONSTRAINT "PrintJobFile_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
