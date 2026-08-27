-- 所要時間の出どころに「経路検索」を足す（docs/spec.md §29）。
-- 電車の所要時間は trainroute 経由で NAVITIME の経路検索から入れられるようになったため、
-- AIの見積もりと同じ扱いにすると、あとから「この数字はどこから来たのか」を読めなくなる。
--
-- 既存の行はすべて MANUAL か AI のいずれかで、値を足すだけでは意味が変わらない。
-- 既定値も MANUAL のまま変えないため、データの書き換えは要らない。

ALTER TABLE `TravelPlan`
  MODIFY COLUMN `estimateSource` ENUM('MANUAL', 'AI', 'TRANSIT') NOT NULL DEFAULT 'MANUAL';
