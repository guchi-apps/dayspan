-- 所要時間の出どころにGoogleマップ（利用者がコピーした普段の所要時間）を追加する（#1025）。
ALTER TABLE `TravelPlan` MODIFY `estimateSource` ENUM('MANUAL', 'AI', 'TRANSIT', 'YAHOO', 'GOOGLE_MAPS') NOT NULL DEFAULT 'MANUAL';
