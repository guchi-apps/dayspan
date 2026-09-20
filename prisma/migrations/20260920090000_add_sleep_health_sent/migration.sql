-- ヘルスケアへ送った時点の睡眠の時間帯（docs/spec.md §40「送ったあとの変更」）。
-- 送ったあとに時刻を直した・消した睡眠を見つけるために、Googleの予定IDごとに持つ。

-- AlterTable
ALTER TABLE `ShortcutToken` ADD COLUMN `sleepHealthPending` JSON NULL;

-- CreateTable
CREATE TABLE `SleepHealthSent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(255) NOT NULL,
    `start` DATETIME(3) NOT NULL,
    `end` DATETIME(3) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SleepHealthSent_userId_end_idx`(`userId`, `end`),
    UNIQUE INDEX `SleepHealthSent_userId_eventId_key`(`userId`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SleepHealthSent` ADD CONSTRAINT `SleepHealthSent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
