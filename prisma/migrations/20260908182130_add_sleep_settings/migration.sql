-- AlterTable
ALTER TABLE `UiSetting` ADD COLUMN `sleepActivityTitle` VARCHAR(191) NOT NULL DEFAULT '睡眠',
    ADD COLUMN `sleepTargetMinutes` INTEGER NOT NULL DEFAULT 420;
