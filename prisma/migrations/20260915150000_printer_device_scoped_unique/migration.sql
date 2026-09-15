-- Feature 2 Phase 2C.2 — allow same printerName under different AgentDevices in one Shop.
-- Precondition: Printer_agentDeviceId_printerName_key already exists (Phase 2C.1).
-- Inspected: no duplicate (shopId, printerName) rows in local DB before drop.
-- Retains every Printer row; drops only the shop-level uniqueness constraint.

DROP INDEX `Printer_shopId_printerName_key` ON `Printer`;

-- Non-unique lookup aid for legacy shop-scoped findFirst(shopId, printerName).
CREATE INDEX `Printer_shopId_printerName_idx` ON `Printer`(`shopId`, `printerName`);
