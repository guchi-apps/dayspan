import assert from "node:assert/strict";
import test from "node:test";

import { japaneseHolidayName, japaneseHolidays } from "@/lib/japanese-holidays";

test("対象範囲外（2006年以前・2100年以降）は祝日なし", () => {
  assert.equal(japaneseHolidays(2006).size, 0);
  assert.equal(japaneseHolidays(2100).size, 0);
});

test("対象範囲の境界（2007年・2099年）は祝日を返す", () => {
  assert.ok(japaneseHolidays(2007).size > 0);
  assert.equal(japaneseHolidayName("2007-01-01"), "元日");
  assert.ok(japaneseHolidays(2099).size > 0);
});

test("ハッピーマンデー: 成人の日は1月の第2月曜（2026年は1/12）", () => {
  assert.equal(japaneseHolidayName("2026-01-12"), "成人の日");
  assert.equal(japaneseHolidayName("2026-01-05"), null);
});

test("天皇誕生日: 2018年以前は12/23", () => {
  assert.equal(japaneseHolidayName("2018-12-23"), "天皇誕生日");
});

test("天皇誕生日: 2019年は不在（前後どちらの日付も祝日ではない）", () => {
  assert.equal(japaneseHolidayName("2019-12-23"), null);
  assert.equal(japaneseHolidayName("2019-02-23"), null);
});

test("天皇誕生日: 2020年以降は2/23", () => {
  assert.equal(japaneseHolidayName("2020-02-23"), "天皇誕生日");
});

test("2019年の代替わり: 天皇の即位の日・即位礼正殿の儀の行われる日", () => {
  assert.equal(japaneseHolidayName("2019-05-01"), "天皇の即位の日");
  assert.equal(japaneseHolidayName("2019-10-22"), "即位礼正殿の儀の行われる日");
});

test("2019年ゴールデンウィーク: 前後を祝日に挟まれた4/30・5/2は国民の休日", () => {
  // 4/29(月, 昭和の日) 4/30(火) 5/1(水, 天皇の即位の日) 5/2(木) 5/3(金, 憲法記念日)
  assert.equal(japaneseHolidayName("2019-04-30"), "国民の休日");
  assert.equal(japaneseHolidayName("2019-05-02"), "国民の休日");
});

test("2019年ゴールデンウィーク: 日曜のこどもの日(5/5)は5/6が振替休日になる", () => {
  assert.equal(japaneseHolidayName("2019-05-05"), "こどもの日");
  assert.equal(japaneseHolidayName("2019-05-06"), "振替休日");
});

test("シルバーウィーク2015: 敬老の日と秋分の日に挟まれた9/22は国民の休日", () => {
  // 9/21(月, 敬老の日) 9/22(火) 9/23(水, 秋分の日)
  assert.equal(japaneseHolidayName("2015-09-21"), "敬老の日");
  assert.equal(japaneseHolidayName("2015-09-22"), "国民の休日");
  assert.equal(japaneseHolidayName("2015-09-23"), "秋分の日");
});

test("振替休日: 日曜と重なった固定日の祝日は翌日（祝日でなければ）に振り替わる", () => {
  // 2024-02-11(建国記念の日)は日曜。
  assert.equal(japaneseHolidayName("2024-02-11"), "建国記念の日");
  assert.equal(japaneseHolidayName("2024-02-12"), "振替休日");
});

test("東京オリンピック特例2020: 海の日・スポーツの日・山の日が移動する", () => {
  assert.equal(japaneseHolidayName("2020-07-23"), "海の日");
  assert.equal(japaneseHolidayName("2020-07-24"), "スポーツの日");
  assert.equal(japaneseHolidayName("2020-08-10"), "山の日");
  // 通常の海の日（7月第3月曜）は祝日ではなくなっている。
  assert.equal(japaneseHolidayName("2020-07-20"), null);
});

test("東京オリンピック特例2021: 海の日・スポーツの日・山の日が移動する", () => {
  assert.equal(japaneseHolidayName("2021-07-22"), "海の日");
  assert.equal(japaneseHolidayName("2021-07-23"), "スポーツの日");
  assert.equal(japaneseHolidayName("2021-08-08"), "山の日");
});

test("特例のない年は体育の日（2019年以前）／スポーツの日（2020年以降）が10月第2月曜", () => {
  assert.equal(japaneseHolidayName("2018-10-08"), "体育の日");
  assert.equal(japaneseHolidayName("2022-10-10"), "スポーツの日");
});

test("山の日は2016年施行前は存在しない", () => {
  assert.equal(japaneseHolidayName("2015-08-11"), null);
  assert.equal(japaneseHolidayName("2016-08-11"), "山の日");
});

test("平日は祝日として扱わない", () => {
  assert.equal(japaneseHolidayName("2026-04-02"), null);
});
