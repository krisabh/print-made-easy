-- Admin coupon definitions and redemption ledger.
-- Does not alter BillingPayment columns or payment creation behavior.

CREATE TABLE `Coupon` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `type` ENUM('PERCENT', 'FIXED') NOT NULL,
    `value` INTEGER NOT NULL,
    `validFrom` DATETIME(3) NOT NULL,
    `validUntil` DATETIME(3) NOT NULL,
    `maxRedemptions` INTEGER NULL,
    `perShopLimit` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `shopId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Coupon_code_key`(`code`),
    INDEX `Coupon_shopId_idx`(`shopId`),
    INDEX `Coupon_isActive_idx`(`isActive`),
    INDEX `Coupon_validUntil_idx`(`validUntil`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CouponRedemption` (
    `id` VARCHAR(191) NOT NULL,
    `couponId` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `billingPaymentId` VARCHAR(191) NOT NULL,
    `redeemedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CouponRedemption_billingPaymentId_key`(`billingPaymentId`),
    INDEX `CouponRedemption_couponId_idx`(`couponId`),
    INDEX `CouponRedemption_shopId_idx`(`shopId`),
    INDEX `CouponRedemption_couponId_shopId_idx`(`couponId`, `shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Coupon` ADD CONSTRAINT `Coupon_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_couponId_fkey` FOREIGN KEY (`couponId`) REFERENCES `Coupon`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `CouponRedemption` ADD CONSTRAINT `CouponRedemption_billingPaymentId_fkey` FOREIGN KEY (`billingPaymentId`) REFERENCES `BillingPayment`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
