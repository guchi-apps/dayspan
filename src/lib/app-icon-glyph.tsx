/**
 * アプリアイコンの配色。favicon・apple-icon・PWAアイコンの4箇所で同じ色を使うため、
 * 各ファイルへ直接書かず、ここを一次情報源にする。
 *
 * 図柄は背景より暗い色にする。背景が淡い青のとき図柄を白のままにすると
 * カレンダー枠と背景のコントラストが1.7:1まで落ち、32pxのfaviconで枠が背景に沈むため。
 */
export const APP_ICON_BACKGROUND = "#5094d3";
export const APP_ICON_FOREGROUND = "#082540";

/**
 * DaySpanのアプリアイコン。カレンダー枠の中に「1日分の時間帯（span）」を表す縦棒を置き、
 * 月表示と時間グリッドを併せ持つアプリであることを示す。
 * 縦棒は塗らずに背景色で抜き、枠と棒の境目を色数を増やさずに出す。
 */
export function AppIconGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" fill={APP_ICON_FOREGROUND} />
      <rect x="7" y="2" width="2" height="4.5" rx="1" fill={APP_ICON_FOREGROUND} />
      <rect x="15" y="2" width="2" height="4.5" rx="1" fill={APP_ICON_FOREGROUND} />
      <rect x="6" y="9.5" width="4.5" height="8" rx="1.5" fill={APP_ICON_BACKGROUND} />
      <rect x="13.5" y="9.5" width="4.5" height="4" rx="1.5" fill={APP_ICON_BACKGROUND} />
    </svg>
  );
}
