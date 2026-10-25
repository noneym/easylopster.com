-- AlterTable
ALTER TABLE `User` ADD COLUMN `limitBots` INTEGER NULL,
    ADD COLUMN `limitMcp` INTEGER NULL,
    ADD COLUMN `limitMessagesPerDay` INTEGER NULL,
    ADD COLUMN `limitNodes` INTEGER NULL;

