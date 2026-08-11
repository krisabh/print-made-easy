-- CreateTable
CREATE TABLE `Shop` (
    `id` VARCHAR(191) NOT NULL,
    `shopCode` VARCHAR(64) NOT NULL,
    `shopName` VARCHAR(255) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `email` VARCHAR(255) NULL,
    `address` TEXT NOT NULL,
    `logo` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `agentId` VARCHAR(128) NULL,
    `agentTokenHash` VARCHAR(128) NULL,
    `agentLastSeen` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Shop_shopCode_key`(`shopCode`),
    INDEX `Shop_agentId_idx`(`agentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrintPrice` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `bwSingle` DECIMAL(10, 2) NOT NULL,
    `bwDouble` DECIMAL(10, 2) NOT NULL,
    `colorSingle` DECIMAL(10, 2) NOT NULL,
    `colorDouble` DECIMAL(10, 2) NOT NULL,
    `minimumCharge` DECIMAL(10, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PrintPrice_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Printer` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `printerName` VARCHAR(255) NOT NULL,
    `printerModel` VARCHAR(255) NULL,
    `printerType` VARCHAR(64) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(64) NOT NULL DEFAULT 'offline',
    `lastSeen` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Printer_shopId_idx`(`shopId`),
    UNIQUE INDEX `Printer_shopId_printerName_key`(`shopId`, `printerName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Inventory` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `paperAvailable` INTEGER NOT NULL DEFAULT 0,
    `estimatedInkLevel` INTEGER NOT NULL DEFAULT 100,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Inventory_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrintJob` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `jobNumber` VARCHAR(64) NOT NULL,
    `copies` INTEGER NOT NULL DEFAULT 1,
    `totalPages` INTEGER NOT NULL,
    `printMode` ENUM('BW', 'COLOR') NOT NULL,
    `printType` ENUM('SINGLE', 'DOUBLE') NOT NULL,
    `totalPrice` DECIMAL(10, 2) NOT NULL,
    `status` ENUM('PENDING', 'PRINTING', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `printAttempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PrintJob_jobNumber_key`(`jobNumber`),
    INDEX `PrintJob_status_idx`(`status`),
    INDEX `PrintJob_createdAt_idx`(`createdAt`),
    INDEX `PrintJob_shopId_idx`(`shopId`),
    INDEX `PrintJob_shopId_status_idx`(`shopId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrintJobFile` (
    `id` VARCHAR(191) NOT NULL,
    `printJobId` VARCHAR(191) NOT NULL,
    `originalFileName` VARCHAR(500) NOT NULL,
    `storedFileName` VARCHAR(255) NOT NULL,
    `fileExtension` VARCHAR(32) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `totalPages` INTEGER NOT NULL,
    `printedAt` DATETIME(3) NULL,
    `fileDeletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PrintJobFile_printJobId_idx`(`printJobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Settings` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(16) NOT NULL DEFAULT 'INR',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `autoDeleteDays` INTEGER NOT NULL DEFAULT 7,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Settings_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PrintPrice` ADD CONSTRAINT `PrintPrice_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Printer` ADD CONSTRAINT `Printer_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Inventory` ADD CONSTRAINT `Inventory_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrintJob` ADD CONSTRAINT `PrintJob_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PrintJobFile` ADD CONSTRAINT `PrintJobFile_printJobId_fkey` FOREIGN KEY (`printJobId`) REFERENCES `PrintJob`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Settings` ADD CONSTRAINT `Settings_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;