-- タスクの本体をYoteiFlowのDBへ置けるようにする（issue #919）。
-- 既存ユーザーは tasksInDb = false のままで、従来どおりNotionが正。
ALTER TABLE `NotionConnection`
  ADD COLUMN `tasksInDb` BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE `Task` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `due` VARCHAR(40) NULL,
  `planned` VARCHAR(40) NULL,
  `done` BOOLEAN NOT NULL DEFAULT false,
  `skipped` BOOLEAN NOT NULL DEFAULT false,
  `progress` VARCHAR(191) NULL,
  `priority` VARCHAR(191) NULL,
  `tags` JSON NOT NULL,
  `memo` TEXT NULL,
  `recurrence` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `Task_userId_done_idx`(`userId`, `done`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TaskOption` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `kind` ENUM('TAG', 'PROGRESS') NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `color` VARCHAR(191) NOT NULL DEFAULT 'default',
  `sort` INTEGER NOT NULL DEFAULT 0,

  UNIQUE INDEX `TaskOption_userId_kind_name_key`(`userId`, `kind`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Task` ADD CONSTRAINT `Task_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `TaskOption` ADD CONSTRAINT `TaskOption_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
