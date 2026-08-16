-- ゴミの収集日のNotion DB（docs/spec.md §9）。myroomが日次で書き直し、DaySpanからは読むだけ。
-- 日付リマインドDBと同じ4列構成にする（読み取り経路をそのまま流用するため）。

ALTER TABLE `NotionConnection`
  ADD COLUMN `garbageDataSourceId` VARCHAR(191) NULL,
  ADD COLUMN `garbageDatabaseId` VARCHAR(191) NULL,
  ADD COLUMN `garbageTitle` VARCHAR(191) NULL,
  ADD COLUMN `garbagePropertyMap` JSON NULL;
