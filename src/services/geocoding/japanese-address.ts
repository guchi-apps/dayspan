/**
 * 日本の住所を1本の文字列へ組み立てる（docs/spec.md §9）。
 *
 * 取得元が2つある（Nominatimの `address` と、OSMの生タグを読むOverpass）。同じ地点でも
 * 部品の入り方が違うため、繋ぎ方の規則はここ1か所に置く。
 */

/**
 * 住所の部品。呼び出し側は自分の取得元の項目をこの形へ移してから渡す。
 *
 * 名前はOSMの `addr:*` に合わせている。Nominatimも日本では同じ役割で返す
 * （`quarter`＝町名、`neighbourhood`＝丁目）。
 */
export type JapaneseAddressParts = {
  /** 都道府県。 */
  province?: string;
  /** 市区町村。 */
  city?: string;
  /** 郡・支庁など、市区町村と区の間に入る区分。 */
  district?: string;
  /** 政令指定都市の区（大阪市の「北区」など）。 */
  suburb?: string;
  /** 町名（「中桜塚」）。 */
  quarter?: string;
  /** 丁目。「3」のような数字だけの形と、「渋谷二丁目」のような町名を含む形の両方が来る。 */
  neighbourhood?: string;
  /** 街区符号（「21」）。Nominatimは返さない。 */
  block?: string;
  /** 住居番号（「1」）。街区符号と繋がって「21-1」の形で入っていることもある。 */
  houseNumber?: string;
};

/** 数字だけの丁目（OSMの `addr:neighbourhood="3"`）かどうか。 */
function isNumericChome(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

/**
 * 同じ地名を二重に並べずに繋ぐ。
 *
 * 「渋谷区」と「渋谷区」のように、上位の区分と同じ値が別の項目にも入っていることがある。
 * 突き合わせるのは区切りごとの値そのものにする（部分一致で落とすと、「渋谷区」を入れたあとの
 * 町名「渋谷」まで消えて「東京都渋谷区2-24-12」になる）。
 */
function appendUnique(segments: string[], value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed || segments.includes(trimmed)) return;
  segments.push(trimmed);
}

/**
 * 番地（街区符号＋住居番号）を組み立てる。読めなければnull。
 *
 * **街区符号が取れないときは住居番号ごと落とす。** Nominatimは日本の住所から
 * `addr:block_number` を落として `house_number` だけを返すため、そのまま繋ぐと
 * 渋谷2-21-1 が「渋谷二丁目1」という実在しない住所になる（issue #453）。
 * 番地の無い住所は丁目までで正しく、誤った番地より地図で当たる地点が近い。
 */
function buildBanchi(block: string | undefined, houseNumber: string | undefined): string | null {
  const blockValue = block?.trim();
  const houseValue = houseNumber?.trim();

  // 「21-1」のように住居番号の側へ街区符号ごと入っていることがある。そのまま使う。
  if (houseValue?.includes("-")) return houseValue;

  if (!blockValue) return null;
  return houseValue ? `${blockValue}-${houseValue}` : blockValue;
}

/**
 * 日本の住所として読める順に組み立てる。1つも部品が無ければnull。
 *
 * Nominatimの `display_name` をそのまま使わないのは、細かい方から国まで逆順にカンマで
 * 並ぶため（「南改札, 玉川通り, 渋谷二丁目, …, 日本」）。予定表の場所欄に入れて読める形にならない。
 */
export function composeJapaneseAddress(parts: JapaneseAddressParts): string | null {
  const segments: string[] = [];
  for (const value of [parts.province, parts.city, parts.district, parts.suburb]) {
    appendUnique(segments, value);
  }

  const quarter = parts.quarter?.trim();
  const chome = parts.neighbourhood?.trim();

  // 丁目が「渋谷二丁目」の形で町名を含んでいるときは、町名を別に繋がない（Nominatimはこの形）。
  if (quarter && !(chome && chome.includes(quarter))) appendUnique(segments, quarter);
  if (chome) segments.push(chome);

  const result = segments.join("");
  const banchi = buildBanchi(parts.block, parts.houseNumber);
  if (!banchi) return result || null;

  // 「中桜塚3」のように丁目が数字だけのときは、番地との境目が読めるようハイフンで繋ぐ
  // （中桜塚3-1-1）。「渋谷二丁目」のように単位まで入っている形は、そのまま続ける。
  return chome && isNumericChome(chome) ? `${result}-${banchi}` : result + banchi;
}

/** 丁目に使う漢数字。日本の住所で丁目が99を超えることはない。 */
const KANJI_DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 「3」→「三」、「12」→「十二」。読めない値はnull。 */
function toKanjiNumber(value: string): string | null {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 99) return null;
  if (number < 10) return KANJI_DIGITS[number];

  const tens = Math.floor(number / 10);
  const ones = number % 10;
  return `${tens > 1 ? KANJI_DIGITS[tens] : ""}十${KANJI_DIGITS[ones]}`;
}

/**
 * 番地を落として丁目までの住所にする（`composeJapaneseAddress()` の逆向き）。落とせなければnull。
 *
 * Nominatimの地名検索は、番地の入った日本の住所を引けない（`東京都渋谷区渋谷二丁目21-1`・
 * `大阪府豊中市中桜塚3-1-1` はいずれも該当なし。実測）。丁目までなら引けるため、
 * 完全な住所で見つからなかったときの予備にする。地図の中心を決めるだけなので、
 * 丁目の中心に立てば登録されている場所は画面の中に入る。
 *
 * 数字だけの丁目（`中桜塚3-1-1`）は漢数字へ直す。`中桜塚3` のまま引くとNominatimは
 * 一丁目を返し、別の丁目が中心になる（実測）。
 */
export function broadenJapaneseAddress(address: string): string | null {
  const value = address.trim();

  // 「…二丁目21-1」。丁目まで書かれていれば、そこから後ろを落とすだけでよい。
  const chome = value.match(/^(.*丁目)\d+(?:-\d+)*$/);
  if (chome) return chome[1];

  // 「…中桜塚3-1-1」。先頭の数字が丁目で、残りが番地。丁目は漢数字へ直す。
  const numeric = value.match(/^(.*[^0-9-])(\d+)(?:-\d+)+$/);
  if (numeric) {
    const kanji = toKanjiNumber(numeric[2]);
    return kanji ? `${numeric[1]}${kanji}丁目` : null;
  }

  return null;
}
