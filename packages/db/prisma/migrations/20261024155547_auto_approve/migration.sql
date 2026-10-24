-- AlterTable
ALTER TABLE `Node` ADD COLUMN `autoApprove` JSON NULL;

-- AlterTable
ALTER TABLE `ToolApproval` ADD COLUMN `scopeKey` VARCHAR(191) NULL;

