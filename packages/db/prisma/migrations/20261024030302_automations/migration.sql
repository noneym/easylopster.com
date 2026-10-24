-- AlterTable
ALTER TABLE `Bot` ADD COLUMN `ownerTgChatId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Automation` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `schedule` JSON NOT NULL,
    `prompt` TEXT NOT NULL,
    `sessionTarget` VARCHAR(191) NOT NULL DEFAULT 'main',
    `delivery` VARCHAR(191) NOT NULL DEFAULT 'announce',
    `idleOnly` BOOLEAN NOT NULL DEFAULT false,
    `createdBy` VARCHAR(191) NOT NULL DEFAULT 'owner',
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(191) NULL,
    `lastResult` TEXT NULL,
    `lastError` VARCHAR(1000) NULL,
    `runCount` INTEGER NOT NULL DEFAULT 0,
    `failures` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Automation_enabled_nextRunAt_idx`(`enabled`, `nextRunAt`),
    INDEX `Automation_botId_idx`(`botId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Automation` ADD CONSTRAINT `Automation_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

