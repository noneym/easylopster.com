-- AlterTable
ALTER TABLE `McpServer` ADD COLUMN `authStatus` VARCHAR(191) NOT NULL DEFAULT 'none',
    ADD COLUMN `encOAuth` TEXT NULL;

