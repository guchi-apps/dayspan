-- 祝日として扱うGoogleカレンダーを設定できるようにする（issue #699）。

ALTER TABLE `UiSetting` ADD COLUMN `holidayCalendarId` VARCHAR(191) NULL;
