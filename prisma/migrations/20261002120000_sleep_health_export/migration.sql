-- CreateTable
CREATE TABLE `SleepHealthExport` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `exportedUntil` DATETIME(3) NULL,
    `pending` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SleepHealthExport_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SleepHealthExport` ADD CONSTRAINT `SleepHealthExport_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 既存の印と控えを写す（ショートカットのトークンを持つユーザーのぶん）
INSERT INTO `SleepHealthExport` (`id`, `userId`, `exportedUntil`, `pending`, `createdAt`, `updatedAt`)
SELECT CONCAT('she', SUBSTRING(REPLACE(UUID(), '-', ''), 1, 21)), `userId`, `sleepHealthExportedUntil`, `sleepHealthPending`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `ShortcutToken`
WHERE `sleepHealthExportedUntil` IS NOT NULL OR `sleepHealthPending` IS NOT NULL;

-- AlterTable
ALTER TABLE `ShortcutToken` DROP COLUMN `sleepHealthExportedUntil`,
    DROP COLUMN `sleepHealthPending`;
