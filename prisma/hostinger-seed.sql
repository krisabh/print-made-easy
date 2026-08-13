-- Demo shop seed for phpMyAdmin (SQL tab → Run)
-- Only needed once. Shop code: PME001

SET @shopId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
SET @now = NOW(3);

INSERT INTO `Shop` (
  `id`, `shopCode`, `shopName`, `phone`, `email`, `address`, `logo`,
  `isActive`, `agentId`, `agentTokenHash`, `agentLastSeen`, `createdAt`, `updatedAt`
) VALUES (
  @shopId, 'PME001', 'Demo Print Shop', '9876543210', NULL, 'Demo Address', NULL,
  true, NULL, NULL, NULL, @now, @now
);

INSERT INTO `PrintPrice` (
  `id`, `shopId`, `bwSingle`, `bwDouble`, `colorSingle`, `colorDouble`,
  `minimumCharge`, `createdAt`, `updatedAt`
) VALUES (
  'b1b2c3d4-e5f6-7890-abcd-ef1234567891', @shopId, 2.00, 1.50, 10.00, 8.00, 5.00, @now, @now
);

INSERT INTO `Settings` (
  `id`, `shopId`, `currency`, `timezone`, `autoDeleteDays`, `createdAt`, `updatedAt`
) VALUES (
  'c1b2c3d4-e5f6-7890-abcd-ef1234567892', @shopId, 'INR', 'Asia/Kolkata', 7, @now, @now
);

INSERT INTO `Inventory` (
  `id`, `shopId`, `paperAvailable`, `estimatedInkLevel`, `updatedAt`
) VALUES (
  'd1b2c3d4-e5f6-7890-abcd-ef1234567893', @shopId, 0, 100, @now
);
