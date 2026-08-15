/**
 * アプリアイコンの配色。favicon・apple-icon・PWAアイコンの4箇所で同じ色を使うため、
 * 各ファイルへ直接書かず、ここを一次情報源にする。
 *
 * 背景はアプリのテーマ色（globals.css の --md-primary）と同じ紫にする。ログイン画面の
 * 「Googleでログイン」ボタンと同じ色で、manifest の theme_color とも揃う。
 * 図柄は白。この紫と白のコントラストは6.4:1あり、32pxのfaviconでも枠が背景に沈まない。
 * 背景を淡い色に変える場合は、白のままだとコントラストが3.0を割るため図柄側も暗い色に戻す。
 */
export const APP_ICON_BACKGROUND = "#6750a4";
export const APP_ICON_FOREGROUND = "#ffffff";

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
