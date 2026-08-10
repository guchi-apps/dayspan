import type { TagColor, TagOption } from "@/services/notion/tag-options";

// Notionのタグは淡い背景に濃い文字で描かれる。Notionで見たときと同じ色で分かるよう、
// DaySpanでも同じ色名から同系色を引く。
//
// 明るい配色・暗い配色の両方で読めるようにするため、背景は不透明度つきの1色にして
// 文字色だけを配色ごとに変える（globals.cssはprefers-color-schemeに追従する）。

const CHIP_CLASSES: Record<TagColor, string> = {
  default: "bg-on-surface/10 text-on-surface-variant",
  gray: "bg-gray-500/18 text-gray-700 dark:text-gray-300",
  brown: "bg-amber-800/18 text-amber-800 dark:text-amber-600",
  orange: "bg-orange-500/18 text-orange-700 dark:text-orange-300",
  yellow: "bg-yellow-500/22 text-yellow-800 dark:text-yellow-200",
  green: "bg-green-500/18 text-green-700 dark:text-green-300",
  blue: "bg-blue-500/18 text-blue-700 dark:text-blue-300",
  purple: "bg-purple-500/18 text-purple-700 dark:text-purple-300",
  pink: "bg-pink-500/18 text-pink-700 dark:text-pink-300",
  red: "bg-red-500/18 text-red-700 dark:text-red-300",
};

/** 色を選ぶときの見本。中身が無いため、背景だけで色が分かるよう濃さを上げる。 */
const SWATCH_CLASSES: Record<TagColor, string> = {
  default: "bg-on-surface/30",
  gray: "bg-gray-500",
  brown: "bg-amber-800",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  purple: "bg-purple-500",
  pink: "bg-pink-500",
  red: "bg-red-500",
};

export function tagChipClass(color: TagColor): string {
  return CHIP_CLASSES[color];
}

export function tagSwatchClass(color: TagColor): string {
  return SWATCH_CLASSES[color];
}

/**
 * 名前から色を引く。
 *
 * 登録されていない名前もタグとして使える（入力画面から新しい名前を入れると、Notionが
 * 選択肢を足す）。その回の表示ではまだ色が分からないため、既定として描く。
 */
export function tagColorOf(options: TagOption[], name: string): TagColor {
  return options.find((option) => option.name === name)?.color ?? "default";
}
