-- Feature 2 Phase 2A: multi-device Agent foundation (additive only).
-- Creates AgentDevice + optional PrintJob claim ownership columns.
-- Does NOT remove or rewrite Shop.agentId / agentTokenHash / agentLastSeen.
-- Does NOT modify Printer tables or data.
-- Runtime still uses Shop agent fields; AgentDevice is unused until later phases.

CREATE TABLE `AgentDevice` (
    `id` VARCHAR(191) NOT NULL,
    `shopId` VARCHAR(191) NOT NULL,
    `agentId` VARCHAR(128) NOT NULL,
    `tokenHash` VARCHAR(128) NOT NULL,
    `lastSeen` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `AgentDevice_shopId_agentId_key` ON `AgentDevice`(`shopId`, `agentId`);

CREATE INDEX `AgentDevice_shopId_idx` ON `AgentDevice`(`shopId`);

CREATE INDEX `AgentDevice_tokenHash_idx` ON `AgentDevice`(`tokenHash`);

ALTER TABLE `AgentDevice` ADD CONSTRAINT `AgentDevice_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `Shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `PrintJob` ADD COLUMN `claimedByAgentDeviceId` VARCHAR(191) NULL;

ALTER TABLE `PrintJob` ADD COLUMN `claimedAt` DATETIME(3) NULL;

CREATE INDEX `PrintJob_claimedByAgentDeviceId_idx` ON `PrintJob`(`claimedByAgentDeviceId`);

ALTER TABLE `PrintJob` ADD CONSTRAINT `PrintJob_claimedByAgentDeviceId_fkey` FOREIGN KEY (`claimedByAgentDeviceId`) REFERENCES `AgentDevice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
