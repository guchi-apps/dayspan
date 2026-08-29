/**
 * 場所欄の `名前 住所` を、名前と住所に分ける（docs/spec.md §29）。
 *
 * 場所の候補から選んだあとの欄には `名前 住所` が入る（`toLocationText`）。この形のまま
 * Yahoo!乗換案内へ渡すと地点が引けず、**日時指定ごと捨てられて検索画面が出る**
 * （`cmd=4011`。カンマ区切りの `名前, 住所` も同じ）。住所だけ・名前だけなら引けるため、
 * 渡す前に分ける。
 *
 * 祝日（`japanese-holidays.ts`）と同じく、外部に取りにいかず自前の表で判定する。
 * 分けるためだけに依存を増やさない。
 */

/**
 * 都道府県名。`[都道府県]` の1文字で探すと「京都市」「県民ホール」に当たるため、名前で持つ。
 * 長いほうが先に当たるよう、`京都府` と `京都` のような包含関係は起きない（すべて接尾辞付き）。
 */
const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

/** 名前と住所の間に入る区切り。`toLocationText` は半角スペース、Googleの場所欄は読点が多い。 */
const SEPARATORS = /[\s、,]+$/;

/**
 * `名前 住所` を分ける。住所の始まりが読めなければ null（分けずにそのまま使う）。
 *
 * 住所の始まりは**先頭以外に現れる最初の都道府県名**とする。先頭を飛ばすのは、
 * `東京都新宿区…` のような住所そのものを名前と住所に割らないため。名前側に都道府県を
 * 含む値（`東京都庁 東京都新宿区…`）でも、2つ目の `東京都` で正しく切れる。
 *
 * 英語の住所や `梅田スカイビル` のような施設名だけの値は null になるが、どちらも
 * Yahoo!がそのまま引けることを確かめている（docs/spec.md §29）。
 */
export function splitNameAndAddress(text: string): { name: string; address: string } | null {
  const value = text.trim();
  if (!value) return null;

  let at = -1;
  for (const prefecture of PREFECTURES) {
    const index = value.indexOf(prefecture, 1);
    if (index > 0 && (at === -1 || index < at)) at = index;
  }
  if (at <= 0) return null;

  const name = value.slice(0, at).replace(SEPARATORS, "").trim();
  const address = value.slice(at).trim();
  // 区切りを外した結果どちらかが空になるなら、分けても得るものが無い。
  if (!name || !address) return null;

  return { name, address };
}
