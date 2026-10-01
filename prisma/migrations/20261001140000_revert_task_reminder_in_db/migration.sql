-- タスク・日付リマインドの本体をNotionへ戻す（issue #942）。#919・#928 で足したDB経路を撤去する。
-- YoteiFlowのDB側にだけあったタスク・リマインドは破棄される（Notionへは書き戻さない）。
DROP TABLE IF EXISTS `Task`;
DROP TABLE IF EXISTS `TaskOption`;
DROP TABLE IF EXISTS `Reminder`;

ALTER TABLE `NotionConnection`
  DROP COLUMN `tasksInDb`,
  DROP COLUMN `remindersInDb`;
