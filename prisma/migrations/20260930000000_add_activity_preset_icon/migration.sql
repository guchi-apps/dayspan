-- 活動記録の項目にアイコンを選べるようにする（issue #907）。

ALTER TABLE `ActivityPreset` ADD COLUMN `icon` VARCHAR(191) NULL;
