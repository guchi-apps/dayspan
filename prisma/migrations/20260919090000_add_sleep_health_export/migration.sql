-- ヘルスケアへ送り終えた睡眠の終わり（docs/spec.md §40「ヘルスケアへ送る」）。
-- ショートカットが書き終えたあとにだけ進める印で、これより後に終わった睡眠を次に返す。
ALTER TABLE `ShortcutToken` ADD COLUMN `sleepHealthExportedUntil` DATETIME(3) NULL;
