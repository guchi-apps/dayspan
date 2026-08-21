-- 予定に紐づくタスク（docs/spec.md §31）。タスクを「この予定のどの段階でやるか」で置く。
--
-- Google Calendarの予定にもNotionのタスクにも「相手を指す欄」は無く、足せば利用者のDBの
-- 構成を変えることになる。予定とタスクを結ぶ線だけをDaySpanが持つ（移動と同じ考え方）。

CREATE TABLE `TaskEventLink` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `taskId` VARCHAR(191) NOT NULL,
    `calendarId` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `stage` ENUM('BEFORE_START', 'DURING', 'BEFORE_END', 'AFTER_END') NOT NULL,
    `resolvedAt` DATETIME(3) NOT NULL,
    `resolvedAllDay` BOOLEAN NOT NULL DEFAULT false,
    `eventTitle` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    -- 紐づけはタスクにつき1件。行き先の予定日が1つしか無いため、2件目を持てても置けない。
    UNIQUE INDEX `TaskEventLink_userId_taskId_key`(`userId`, `taskId`),
    -- 予定を動かした・消したときに、その予定に紐づくタスクを引くため。
    INDEX `TaskEventLink_userId_eventId_idx`(`userId`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TaskEventLink`
  ADD CONSTRAINT `TaskEventLink_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
