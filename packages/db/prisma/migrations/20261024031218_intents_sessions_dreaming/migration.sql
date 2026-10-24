-- AlterTable
ALTER TABLE `Bot` ADD COLUMN `ackReaction` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `dreaming` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `lastDreamAt` DATETIME(3) NULL,
    ADD COLUMN `resetAtHour` INTEGER NOT NULL DEFAULT 4,
    ADD COLUMN `resetIdleMinutes` INTEGER NOT NULL DEFAULT 240,
    ADD COLUMN `sessionReset` VARCHAR(191) NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE `Conversation` ADD COLUMN `activationOverride` VARCHAR(191) NULL,
    ADD COLUMN `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `thinkingOverride` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `Intent` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `triggerKeywords` JSON NOT NULL,
    `scope` VARCHAR(191) NOT NULL DEFAULT 'conversation',
    `conversationId` VARCHAR(191) NULL,
    `expiresAt` DATETIME(3) NULL,
    `maxFires` INTEGER NOT NULL DEFAULT 1,
    `fires` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Intent_botId_active_idx`(`botId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Intent` ADD CONSTRAINT `Intent_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

