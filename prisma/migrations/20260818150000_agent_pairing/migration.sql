-- Phase 2B-1: secure Print Agent pairing fields on Shop
-- Additive only — no data deletion.

ALTER TABLE `Shop` ADD COLUMN `agentPairingTokenHash` VARCHAR(128) NULL;
ALTER TABLE `Shop` ADD COLUMN `agentPairingExpiresAt` DATETIME(3) NULL;
ALTER TABLE `Shop` ADD COLUMN `agentPairingUsedAt` DATETIME(3) NULL;

CREATE INDEX `Shop_agentPairingTokenHash_idx` ON `Shop`(`agentPairingTokenHash`);
