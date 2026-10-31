-- AlterTable
ALTER TABLE `Bot` MODIFY `encToken` TEXT NULL;

-- CreateTable
CREATE TABLE `ImportSession` (
    `id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NULL,
    `mode` VARCHAR(191) NOT NULL DEFAULT 'bot',
    `status` VARCHAR(191) NOT NULL DEFAULT 'waiting',
    `options` JSON NOT NULL,
    `hostname` VARCHAR(191) NULL,
    `workspace` VARCHAR(1024) NULL,
    `manifest` JSON NULL,
    `progress` JSON NULL,
    `result` JSON NULL,
    `created` JSON NULL,
    `error` VARCHAR(1024) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ImportSession_token_key`(`token`),
    INDEX `ImportSession_botId_idx`(`botId`),
    INDEX `ImportSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ImportSession` ADD CONSTRAINT `ImportSession_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

