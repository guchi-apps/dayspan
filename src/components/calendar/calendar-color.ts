// 予定の色はGoogle側のカレンダー色をそのまま使う（docs/spec.md §5）。
// パレットには淡い色（バナナ・シトロン等）も濃い色（トマト・ブルーベリー等）も含まれるため、
// 文字色を固定すると片方が読めなくなる。背景の明るさから選び直す。

const FALLBACK = "#5484ed";

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** sRGBの相対輝度（WCAG）。0が黒、1が白。 */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export type EventColors = {
  background: string;
  foreground: string;
  /** 淡い色の予定が背景に溶けないよう、少しだけ濃い輪郭を足す。 */
  border: string;
};

const INK = "oklch(0.18 0.01 260)";
const PAPER = "oklch(0.99 0 0)";

// PAPERのおおよその相対輝度。白文字で足りるかの判定に使う。
const PAPER_LUMINANCE = 0.9776;

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 白のままで足りる色は白のままにし、足りない色だけ濃色へ切り替える。
 * 常に最大コントラストを選ぶとトマトやブルーベリーまで黒文字になり、
 * Google Calendar上での見え方から離れすぎるため。3.0はWCAGの大きめ文字の基準。
 */
const WHITE_TEXT_MIN_CONTRAST = 3;

export function eventColors(color: string | null): EventColors {
  const background = color ?? FALLBACK;
  const rgb = parseHex(background) ?? parseHex(FALLBACK)!;
  const luminance = relativeLuminance(rgb);

  const usePaper = contrastRatio(luminance, PAPER_LUMINANCE) >= WHITE_TEXT_MIN_CONTRAST;

  return {
    background,
    foreground: usePaper ? PAPER : INK,
    border: usePaper ? "rgb(255 255 255 / 0.16)" : "rgb(0 0 0 / 0.18)",
  };
}

export type SubduedEventColors = {
  background: string;
  border: string;
  /** 左端に立てる色帯。塗りを落としても、どのカレンダーの予定かが分かるように残す。 */
  accent: string;
};

/**
 * 活動記録のカレンダーに入っている予定の色（issue #241）。
 *
 * 記録は「後から見返す事実」で、これから動くために見る予定とは読む理由が違う。
 * 睡眠のように長い記録をベタ塗りで描くと、その時間帯に入っている予定が読めなくなるため、
 * 塗りを落とし、カレンダー色は左の縦帯として残す。
 *
 * 塗りを完全に外さないのは、長い記録で上下の枠線しか見えなくなり、どの時間帯を
 * 占めているのかが面として追えなくなるため。文字色は背景の明るさから選び直さず
 * テーマの文字色に任せる（塗りが薄いので、下地は常に画面の背景になる）。
 */
export function subduedEventColors(color: string | null): SubduedEventColors {
  const base = color ?? FALLBACK;

  return {
    background: `color-mix(in srgb, ${base} 20%, transparent)`,
    border: `color-mix(in srgb, ${base} 46%, transparent)`,
    // 淡いカレンダー色（バナナ等）だと枠線と同じ濃さでは背景に沈むため、縦帯だけ濃く取る。
    accent: `color-mix(in srgb, ${base} 80%, transparent)`,
  };
}

/** 月表示のタスクなど、色を面ではなく線として使う場面向け。 */
export function eventAccent(color: string | null): string {
  return color ?? FALLBACK;
}
