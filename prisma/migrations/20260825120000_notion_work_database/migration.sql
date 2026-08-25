-- 勤務場所と出張のNotion DB（docs/spec.md §34）。1日1件の勤務場所と、期間で1件の出張を
-- 同じDBに置く。日付リマインドDB・場所DBと同じ4列構成にする。

ALTER TABLE `NotionConnection`
  ADD COLUMN `workDataSourceId` VARCHAR(191) NULL,
  ADD COLUMN `workDatabaseId` VARCHAR(191) NULL,
  ADD COLUMN `workTitle` VARCHAR(191) NULL,
  ADD COLUMN `workPropertyMap` JSON NULL;
