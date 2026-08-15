-- 「表示するカレンダー」と「書き込んでよいカレンダー」を分ける（docs/spec.md §7）。
-- これまで visible が両方を兼ねていたため、見たいだけのカレンダーを保存先から外せなかった。

ALTER TABLE `CalendarSetting` ADD COLUMN `writeEnabled` BOOLEAN NOT NULL DEFAULT true;

-- 既存の設定は、これまで保存先に選べていた範囲をそのまま引き継ぐ。
-- 更新した途端に保存先の選択肢が増減しないようにするため、visible の値をそのまま写す。
UPDATE `CalendarSetting` SET `writeEnabled` = `visible`;
