-- AlterTable
ALTER TABLE `Bot` ADD COLUMN `agentName` VARCHAR(191) NULL,
    ADD COLUMN `lastErrorAt` DATETIME(3) NULL,
    ADD COLUMN `userProfile` TEXT NULL;

-- AlterTable
ALTER TABLE `Conversation` ADD COLUMN `archivedAt` DATETIME(3) NULL,
    ADD COLUMN `modelOverride` VARCHAR(191) NULL;

