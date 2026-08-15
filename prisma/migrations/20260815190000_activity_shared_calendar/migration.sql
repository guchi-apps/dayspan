-- 活動記録の保存先カレンダーを、項目ごと（ActivityPreset.calendarId）から
-- ユーザー共通の1つ（UiSetting.activityCalendarId）へ移す（docs/spec.md §27）。

ALTER TABLE `UiSetting` ADD COLUMN `activityCalendarId` VARCHAR(191) NULL;

-- 設定していた保存先を引き継ぐ。列を消すだけだと、指定していた保存先が黙って既定へ戻る。
-- 項目ごとに違うカレンダーを指定していた場合は、並びの先頭にある指定を採る。
UPDATE `UiSetting` `s`
SET `s`.`activityCalendarId` = (
    SELECT `p`.`calendarId`
    FROM `ActivityPreset` `p`
    WHERE `p`.`userId` = `s`.`userId` AND `p`.`calendarId` IS NOT NULL
    ORDER BY `p`.`sortOrder` ASC, `p`.`createdAt` ASC
    LIMIT 1
);

ALTER TABLE `ActivityPreset` DROP COLUMN `calendarId`;
