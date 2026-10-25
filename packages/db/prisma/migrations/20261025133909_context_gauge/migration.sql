-- AlterTable
ALTER TABLE `Conversation` ADD COLUMN `contextWindow` INTEGER NULL,
    ADD COLUMN `lastInputTokens` INTEGER NULL;

-- AlterTable
ALTER TABLE `ProviderKey` ADD COLUMN `modelsMeta` JSON NULL;

