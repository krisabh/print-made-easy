-- Phase 2A: shop-scoped job numbering
-- Additive + safe: no DROP TABLE / DELETE / TRUNCATE of PrintJob data.

-- 1) Add nullable sequence column
ALTER TABLE `PrintJob` ADD COLUMN `jobSequence` INTEGER NULL;

-- 2) Backfill from PME-###### only (non-matching rows stay NULL and fail step 3)
UPDATE `PrintJob`
SET `jobSequence` = CAST(SUBSTRING(`jobNumber`, 5) AS UNSIGNED)
WHERE `jobSequence` IS NULL
  AND `jobNumber` REGEXP '^PME-[0-9]{6}$';

-- 3) Require sequence (fails if any non-standard jobNumber was not backfilled)
ALTER TABLE `PrintJob` MODIFY COLUMN `jobSequence` INTEGER NOT NULL;

-- 4) Drop global uniqueness on jobNumber
DROP INDEX `PrintJob_jobNumber_key` ON `PrintJob`;

-- 5) Shop-scoped uniqueness
CREATE UNIQUE INDEX `PrintJob_shopId_jobSequence_key` ON `PrintJob`(`shopId`, `jobSequence`);
CREATE UNIQUE INDEX `PrintJob_shopId_jobNumber_key` ON `PrintJob`(`shopId`, `jobNumber`);
