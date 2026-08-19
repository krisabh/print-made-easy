-- AlterTable
ALTER TABLE `User` ADD COLUMN `role` ENUM('SHOPKEEPER', 'ADMIN') NOT NULL DEFAULT 'SHOPKEEPER';

-- CreateIndex
CREATE INDEX `User_role_idx` ON `User`(`role`);
