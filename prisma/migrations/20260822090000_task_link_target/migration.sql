-- 紐づけの行き先（docs/spec.md §31）。段階から決まる日時を、タスクの期限と予定日のどちらへ
-- 入れるかを選べるようにする。
--
-- 既定を PLANNED にするのは、この列を足す前の紐づけがすべて予定日へ書いていたため。
-- 既定値のままで既存の行の意味が変わらず、データの書き換えは要らない。

ALTER TABLE `TaskEventLink`
  ADD COLUMN `target` ENUM('DUE', 'PLANNED') NOT NULL DEFAULT 'PLANNED';

-- 紐づけを「タスクにつき1件」から「タスクの行き先ごとに1件」へ変える。
-- 期限と予定日で別の予定へ紐づけられる一方、同じ行き先の2件目は入る先が1つしか無いため持てない。
DROP INDEX `TaskEventLink_userId_taskId_key` ON `TaskEventLink`;

CREATE UNIQUE INDEX `TaskEventLink_userId_taskId_target_key`
  ON `TaskEventLink`(`userId`, `taskId`, `target`);
