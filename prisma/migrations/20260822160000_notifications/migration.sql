-- 通知（docs/spec.md §32）。
--
-- iOSのホーム画面Webアプリには端末側で通知を予約する手段が無いため、送信はすべてサーバーから行う。
-- 送信先（端末ごと）・何を知らせるか（アカウントごと）・送る前の通知の下書きの3つを持つ。
-- CreateTable
CREATE TABLE `PushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` TEXT NOT NULL,
    `endpointHash` VARCHAR(64) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `origin` VARCHAR(255) NOT NULL,
    `label` VARCHAR(191) NULL,
    `lastSuccessAt` DATETIME(3) NULL,
    `lastFailureAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PushSubscription_endpointHash_key`(`endpointHash`),
    INDEX `PushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationSetting` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `eventEnabled` BOOLEAN NOT NULL DEFAULT true,
    `eventLeadMinutes` INTEGER NOT NULL DEFAULT 10,
    `taskEnabled` BOOLEAN NOT NULL DEFAULT true,
    `taskDigestTime` VARCHAR(5) NOT NULL DEFAULT '08:00',
    `activityEnabled` BOOLEAN NOT NULL DEFAULT true,
    `plannedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `NotificationSetting_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationJob` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` ENUM('EVENT', 'TASK', 'TASK_DIGEST', 'ACTIVITY', 'TEST') NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `url` VARCHAR(255) NOT NULL,
    `badgeCount` INTEGER NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NotificationJob_sentAt_scheduledAt_idx`(`sentAt`, `scheduledAt`),
    INDEX `NotificationJob_userId_scheduledAt_idx`(`userId`, `scheduledAt`),
    UNIQUE INDEX `NotificationJob_userId_dedupeKey_key`(`userId`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationSetting` ADD CONSTRAINT `NotificationSetting_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationJob` ADD CONSTRAINT `NotificationJob_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

