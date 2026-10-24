-- AlterTable
ALTER TABLE `Node` ADD COLUMN `execApproval` VARCHAR(191) NOT NULL DEFAULT 'always';

-- AlterTable
ALTER TABLE `ToolApproval` ADD COLUMN `channel` JSON NULL;

