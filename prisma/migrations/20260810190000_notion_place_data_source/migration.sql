ALTER TABLE `NotionConnection`
  ADD COLUMN `placeDataSourceId` VARCHAR(191) NULL,
  ADD COLUMN `placeDatabaseId` VARCHAR(191) NULL,
  ADD COLUMN `placeTitle` VARCHAR(191) NULL,
  ADD COLUMN `placePropertyMap` JSON NULL;
