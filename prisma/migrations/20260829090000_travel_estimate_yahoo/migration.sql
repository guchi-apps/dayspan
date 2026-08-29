-- 所要時間の出どころに「Yahoo!乗換案内」を足す（docs/spec.md §29）。
-- 電車の所要時間は、利用者がYahoo!乗換案内で選んだ経路をコピーして取り込めるようになった。
-- これだけは実際のダイヤ上の列車で、AIの目安（AI）とも経路検索の平均（TRANSIT）とも
-- 確からしさが違う。同じ値へまとめると、あとから「この数字はどこから来たのか」を読めなくなる。
--
-- 既存の行は MANUAL / AI / TRANSIT のいずれかで、値を足すだけでは意味が変わらない。
-- 既定値も MANUAL のまま変えないため、データの書き換えは要らない。

ALTER TABLE `TravelPlan`
  MODIFY COLUMN `estimateSource` ENUM('MANUAL', 'AI', 'TRANSIT', 'YAHOO') NOT NULL DEFAULT 'MANUAL';
