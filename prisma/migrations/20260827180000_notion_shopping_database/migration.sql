-- 買い物リストのNotion DB（docs/spec.md §36）。shopping-listアプリが読み書きしているDBを
-- そのまま指せるようにする。日付リマインドDB・場所DB・勤務記録DBと同じ4列構成にする。

ALTER TABLE `NotionConnection`
  ADD COLUMN `shoppingDataSourceId` VARCHAR(191) NULL,
  ADD COLUMN `shoppingDatabaseId` VARCHAR(191) NULL,
  ADD COLUMN `shoppingTitle` VARCHAR(191) NULL,
  ADD COLUMN `shoppingPropertyMap` JSON NULL;
