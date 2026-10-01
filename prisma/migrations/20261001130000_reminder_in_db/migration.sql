-- 日付リマインドの本体をYoteiFlowのDBへ置けるようにする（issue #928）。
-- 既存ユーザーは remindersInDb = false のままで、従来どおりNotionが正。
ALTER TABLE `NotionConnection`
  ADD COLUMN `remindersInDb` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `TaskOption`
  MODIFY `kind` ENUM('TAG', 'PROGRESS', 'REMINDER') NOT NULL;

CREATE TABLE `Reminder` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `date` VARCHAR(40) NOT NULL,
  `category` VARCHAR(191) NULL,
  `memo` TEXT NULL,
  `annual` BOOLEAN NOT NULL DEFAULT false,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `Reminder_userId_date_idx`(`userId`, `date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Reminder` ADD CONSTRAINT `Reminder_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
