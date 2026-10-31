-- CreateTable
CREATE TABLE `StorageConfig` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 's3',
    `endpoint` VARCHAR(512) NULL,
    `region` VARCHAR(191) NOT NULL DEFAULT 'auto',
    `bucket` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(191) NOT NULL DEFAULT '',
    `forcePathStyle` BOOLEAN NOT NULL DEFAULT false,
    `encAccessKey` TEXT NOT NULL,
    `encSecretKey` TEXT NOT NULL,
    `accessKeyLast4` VARCHAR(191) NOT NULL,
    `lastTestedAt` DATETIME(3) NULL,
    `lastTestOk` BOOLEAN NULL,
    `lastTestMsg` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StorageConfig_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BackupPolicy` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `schedule` JSON NOT NULL,
    `retentionDays` INTEGER NULL DEFAULT 7,
    `keepLast` INTEGER NOT NULL DEFAULT 3,
    `includeConversations` BOOLEAN NOT NULL DEFAULT false,
    `includeInbox` BOOLEAN NOT NULL DEFAULT false,
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(191) NULL,
    `lastError` VARCHAR(1024) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BackupPolicy_botId_key`(`botId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Backup` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(1024) NOT NULL,
    `bytes` INTEGER NOT NULL,
    `manifest` JSON NULL,
    `trigger` VARCHAR(191) NOT NULL DEFAULT 'scheduled',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Backup_botId_createdAt_idx`(`botId`, `createdAt`),
    INDEX `Backup_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StorageConfig` ADD CONSTRAINT `StorageConfig_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BackupPolicy` ADD CONSTRAINT `BackupPolicy_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Backup` ADD CONSTRAINT `Backup_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

