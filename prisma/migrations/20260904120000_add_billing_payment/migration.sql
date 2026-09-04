-- CreateTable
CREATE TABLE `BillingPayment` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `mode` VARCHAR(32) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `amountInr` INTEGER NOT NULL,
    `currency` VARCHAR(16) NOT NULL DEFAULT 'INR',
    `providerOrderId` VARCHAR(128) NOT NULL,
    `providerPaymentId` VARCHAR(128) NULL,
    `periodStart` DATETIME(3) NULL,
    `periodEnd` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `failureReason` VARCHAR(500) NULL,
    `metadataJson` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BillingPayment_shopId_idx`(`shopId`),
    INDEX `BillingPayment_status_idx`(`status`),
    INDEX `BillingPayment_providerPaymentId_idx`(`providerPaymentId`),
    INDEX `BillingPayment_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `BillingPayment_provider_providerOrderId_key`(`provider`, `providerOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `BillingPayment` ADD CONSTRAINT `BillingPayment_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
