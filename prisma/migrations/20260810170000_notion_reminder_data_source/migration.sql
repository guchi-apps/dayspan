ALTER TABLE `NotionConnection`
  ADD COLUMN `reminderDataSourceId` VARCHAR(191) NULL,
  ADD COLUMN `reminderDatabaseId` VARCHAR(191) NULL,
  ADD COLUMN `reminderTitle` VARCHAR(191) NULL,
  ADD COLUMN `reminderPropertyMap` JSON NULL;
