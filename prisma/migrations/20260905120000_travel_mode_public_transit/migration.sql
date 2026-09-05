-- 交通手段を4分類（車・公共交通・徒歩・その他）へ統一する（issue #538）。
--
-- 電車・バス・飛行機はいずれもYahoo!乗換案内で経路検索できるため、公共交通として1つに
-- まとめる。自転車はどの分類にも当てはまらないため、その他へ含める。
--
-- 新しい値（PUBLIC_TRANSIT）を含む形へ一度ENUMを広げてから既存行をUPDATEし、最後に
-- 新しい4値だけのENUMへ絞り込む。UPDATEを先に行うと、その時点のENUMにまだ無い値
-- （PUBLIC_TRANSIT）へは書き込めず `Data truncated for column` で失敗するため。

ALTER TABLE `TravelPlan`
  MODIFY COLUMN `mode` ENUM('TRAIN', 'CAR', 'BUS', 'WALK', 'BICYCLE', 'PLANE', 'OTHER', 'PUBLIC_TRANSIT') NOT NULL DEFAULT 'TRAIN';
ALTER TABLE `UiSetting`
  MODIFY COLUMN `travelDefaultMode` ENUM('TRAIN', 'CAR', 'BUS', 'WALK', 'BICYCLE', 'PLANE', 'OTHER', 'PUBLIC_TRANSIT') NOT NULL DEFAULT 'TRAIN';

UPDATE `TravelPlan` SET `mode` = 'PUBLIC_TRANSIT' WHERE `mode` IN ('TRAIN', 'BUS', 'PLANE');
UPDATE `TravelPlan` SET `mode` = 'OTHER' WHERE `mode` = 'BICYCLE';
UPDATE `UiSetting` SET `travelDefaultMode` = 'PUBLIC_TRANSIT' WHERE `travelDefaultMode` IN ('TRAIN', 'BUS', 'PLANE');
UPDATE `UiSetting` SET `travelDefaultMode` = 'OTHER' WHERE `travelDefaultMode` = 'BICYCLE';

ALTER TABLE `TravelPlan`
  MODIFY COLUMN `mode` ENUM('CAR', 'PUBLIC_TRANSIT', 'WALK', 'OTHER') NOT NULL DEFAULT 'PUBLIC_TRANSIT';
ALTER TABLE `UiSetting`
  MODIFY COLUMN `travelDefaultMode` ENUM('CAR', 'PUBLIC_TRANSIT', 'WALK', 'OTHER') NOT NULL DEFAULT 'PUBLIC_TRANSIT';
