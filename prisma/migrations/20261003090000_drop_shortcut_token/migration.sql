-- iPhoneショートカット連携の廃止（#1001）。睡眠のヘルスケア連携はiOSアプリが直接行う。
-- 送った印・履歴は SleepHealthExport / SleepHealthSent にあり、トークンの表だけを破棄する。
ALTER TABLE `ShortcutToken` DROP FOREIGN KEY `ShortcutToken_userId_fkey`;

DROP TABLE `ShortcutToken`;
