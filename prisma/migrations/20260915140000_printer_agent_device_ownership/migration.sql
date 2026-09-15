-- Feature 2 Phase 2C.1 — Printer → AgentDevice ownership foundation (additive).
-- Adds nullable Printer.agentDeviceId + AgentDevice.localDefaultPrinterId.
-- Deterministic backfill only when ownership mapping is unambiguous.
-- Does NOT invent AgentDevice rows.
-- Does NOT remove Printer.shopId or Printer.isDefault.
-- Does NOT change runtime printer behavior (shop-level unique retained).

-- 1) Additive columns
ALTER TABLE `Printer` ADD COLUMN `agentDeviceId` VARCHAR(191) NULL;

ALTER TABLE `AgentDevice` ADD COLUMN `localDefaultPrinterId` VARCHAR(191) NULL;

-- 2) Deterministic backfill Step 2:
-- Prefer AgentDevice whose agentId matches Shop.agentId (exact unique pair).
UPDATE `Printer` p
INNER JOIN `Shop` s ON s.id = p.shopId
INNER JOIN `AgentDevice` ad
  ON ad.shopId = s.id
 AND ad.agentId = s.agentId
SET p.agentDeviceId = ad.id
WHERE p.agentDeviceId IS NULL
  AND s.agentId IS NOT NULL;

-- 3) Deterministic backfill Step 3:
-- If no Shop.agentId match and the Shop has exactly one AgentDevice, assign that device.
UPDATE `Printer` p
INNER JOIN `Shop` s ON s.id = p.shopId
INNER JOIN (
  SELECT shopId, MIN(id) AS deviceId
  FROM `AgentDevice`
  GROUP BY shopId
  HAVING COUNT(*) = 1
) only_one ON only_one.shopId = s.id
INNER JOIN `AgentDevice` ad ON ad.id = only_one.deviceId
SET p.agentDeviceId = ad.id
WHERE p.agentDeviceId IS NULL
  AND (
    s.agentId IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM `AgentDevice` m
      WHERE m.shopId = s.id
        AND m.agentId = s.agentId
    )
  );

-- Steps 4–5: ambiguous multi-device / no-device shops intentionally left NULL.

-- 4) Indexes / uniqueness
CREATE INDEX `Printer_agentDeviceId_idx` ON `Printer`(`agentDeviceId`);

-- Future device-scoped uniqueness. MySQL allows multiple NULLs in unique columns,
-- so unassigned legacy rows remain compatible with retained (shopId, printerName).
CREATE UNIQUE INDEX `Printer_agentDeviceId_printerName_key` ON `Printer`(`agentDeviceId`, `printerName`);

CREATE UNIQUE INDEX `AgentDevice_localDefaultPrinterId_key` ON `AgentDevice`(`localDefaultPrinterId`);

-- 5) Foreign keys
ALTER TABLE `Printer`
  ADD CONSTRAINT `Printer_agentDeviceId_fkey`
  FOREIGN KEY (`agentDeviceId`) REFERENCES `AgentDevice`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AgentDevice`
  ADD CONSTRAINT `AgentDevice_localDefaultPrinterId_fkey`
  FOREIGN KEY (`localDefaultPrinterId`) REFERENCES `Printer`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
