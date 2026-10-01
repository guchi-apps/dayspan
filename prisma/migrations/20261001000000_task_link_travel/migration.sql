-- タスクを移動にも紐づけられるようにする（issue #914・docs/spec.md §31）。
--
-- 紐づけ先が移動のときだけ travelId を持つ。NULLの行は従来どおり予定への紐づけで、
-- 既存の行の意味は変わらない（データの書き換えは要らない）。
ALTER TABLE `TaskEventLink`
  ADD COLUMN `travelId` VARCHAR(191) NULL;

CREATE INDEX `TaskEventLink_userId_travelId_idx` ON `TaskEventLink`(`userId`, `travelId`);
