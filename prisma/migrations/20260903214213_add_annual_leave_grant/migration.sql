-- AlterTable
ALTER TABLE `UiSetting` ADD COLUMN `fiscalYearStartMonth` INTEGER NOT NULL DEFAULT 4;

-- CreateTable
CREATE TABLE `AnnualLeaveGrant` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `fiscalYear` INTEGER NOT NULL,
    `grantedDays` DOUBLE NOT NULL,
    `carriedOverDays` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AnnualLeaveGrant_userId_fiscalYear_key`(`userId`, `fiscalYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AnnualLeaveGrant` ADD CONSTRAINT `AnnualLeaveGrant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
