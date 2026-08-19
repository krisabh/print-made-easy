-- CreateTable
CREATE TABLE `Subscription` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `plan` ENUM('TRIAL', 'PREMIUM') NOT NULL DEFAULT 'TRIAL',
    `status` ENUM('TRIALING', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE') NOT NULL DEFAULT 'TRIALING',
    `trialStartAt` DATETIME(3) NULL,
    `trialEndAt` DATETIME(3) NULL,
    `currentPeriodStart` DATETIME(3) NULL,
    `currentPeriodEnd` DATETIME(3) NULL,
    `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
    `cancelledAt` DATETIME(3) NULL,
    `provider` VARCHAR(64) NULL,
    `providerCustomerId` VARCHAR(128) NULL,
    `providerSubscriptionId` VARCHAR(128) NULL,
    `providerPlanId` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Subscription_shopId_key`(`shopId`),
    INDEX `Subscription_status_idx`(`status`),
    INDEX `Subscription_trialEndAt_idx`(`trialEndAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing shops: additive backfill only.
-- Assign a fresh 7-day TRIALING window starting at migration time.
-- Do NOT assign PREMIUM. Do NOT modify jobs, printers, agent, pricing, or ownership.
INSERT INTO `Subscription` (
  `id`,
  `shopId`,
  `plan`,
  `status`,
  `trialStartAt`,
  `trialEndAt`,
  `currentPeriodStart`,
  `currentPeriodEnd`,
  `cancelAtPeriodEnd`,
  `cancelledAt`,
  `provider`,
  `providerCustomerId`,
  `providerSubscriptionId`,
  `providerPlanId`,
  `createdAt`,
  `updatedAt`
)
SELECT
  UUID(),
  `s`.`id`,
  'TRIAL',
  'TRIALING',
  UTC_TIMESTAMP(3),
  DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 DAY),
  NULL,
  NULL,
  false,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  UTC_TIMESTAMP(3),
  UTC_TIMESTAMP(3)
FROM `Shop` `s`
WHERE NOT EXISTS (
  SELECT 1 FROM `Subscription` `sub` WHERE `sub`.`shopId` = `s`.`id`
);
