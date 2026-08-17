-- 移動（docs/spec.md §29）。出発地・目的地・交通手段はGoogle Calendarの予定には入らないため、
-- 本体をDaySpan側に持つ。Googleへは写しを書き出し、そのIDを控えて二重表示を防ぐ。

CREATE TABLE `TravelPlan` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `origin` VARCHAR(191) NOT NULL,
    `destination` VARCHAR(191) NOT NULL,
    `mode` ENUM('TRAIN', 'CAR', 'BUS', 'WALK', 'BICYCLE', 'PLANE', 'OTHER') NOT NULL DEFAULT 'TRAIN',
    `departAt` DATETIME(3) NOT NULL,
    `arriveAt` DATETIME(3) NOT NULL,
    `note` TEXT NULL,
    `estimateSource` ENUM('MANUAL', 'AI') NOT NULL DEFAULT 'MANUAL',
    `linkedEventId` VARCHAR(191) NULL,
    `linkedCalendarId` VARCHAR(191) NULL,
    `returnLeg` BOOLEAN NOT NULL DEFAULT false,
    `googleCalendarId` VARCHAR(191) NULL,
    `googleEventId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TravelPlan_userId_departAt_idx`(`userId`, `departAt`),
    INDEX `TravelPlan_userId_googleEventId_idx`(`userId`, `googleEventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `TravelPlan`
  ADD CONSTRAINT `TravelPlan_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 移動の既定値。活動記録の保存先と同じく、項目ごとではなく利用者につき1組。
ALTER TABLE `UiSetting`
  ADD COLUMN `travelDefaultOrigin` VARCHAR(191) NULL,
  ADD COLUMN `travelDefaultMode` ENUM('TRAIN', 'CAR', 'BUS', 'WALK', 'BICYCLE', 'PLANE', 'OTHER') NOT NULL DEFAULT 'TRAIN',
  ADD COLUMN `travelRoundTrip` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `travelCalendarId` VARCHAR(191) NULL;
