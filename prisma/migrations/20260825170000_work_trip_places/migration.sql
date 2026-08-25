-- 出張扱いにする勤務場所（docs/spec.md §34）。その場所を選んだ時点で「出張」の既定が立つ。
-- 勤務場所の選択肢は勤務記録DBのselectのプロパティ定義そのもののため、DBの設定と同じ行に置く。

ALTER TABLE `NotionConnection`
  ADD COLUMN `workTripPlaces` JSON NULL;
