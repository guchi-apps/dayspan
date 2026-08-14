-- 活動記録（docs/spec.md §27）。選択肢と「まだ終わっていない1件」だけを持つ。
-- 終わった記録はGoogle Calendarの予定になるため、DaySpan側へは残さない。

-- 初期項目を入れたかどうか。「1件も無いなら入れる」だけで判断すると、
-- 利用者が全部消しても開き直すたびに戻ってきて消せなくなるため、別に持つ。
ALTER TABLE `UiSetting` ADD COLUMN `activityPresetsSeeded` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `ActivityPreset` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `calendarId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ActivityPreset_userId_name_key`(`userId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RunningActivity` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `calendarId` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RunningActivity_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ActivityPreset` ADD CONSTRAINT `ActivityPreset_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `RunningActivity` ADD CONSTRAINT `RunningActivity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
