-- AlterTable
ALTER TABLE `Subscription` ADD COLUMN `pastDueSince` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Subscription_providerSubscriptionId_idx` ON `Subscription`(`providerSubscriptionId`);

-- CreateTable
CREATE TABLE `PaymentWebhookEvent` (
    `id` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `eventType` VARCHAR(128) NOT NULL,
    `payloadHash` VARCHAR(128) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    INDEX `PaymentWebhookEvent_eventType_idx`(`eventType`),
    UNIQUE INDEX `PaymentWebhookEvent_provider_eventId_key`(`provider`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
