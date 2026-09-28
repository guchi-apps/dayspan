/**
 * アプリアイコンの配色。favicon・apple-icon・PWAアイコンの4箇所で同じ色を使うため、
 * 各ファイルへ直接書かず、ここを一次情報源にする。
 *
 * 背景はアプリのテーマ色（globals.css の --md-primary）と同じ紫にする。ログイン画面の
 * 「Googleでログイン」ボタンと同じ色で、manifest の background_color とも揃う。
 * （theme_color はステータスバーの領域の色で、ヘッダーの色に合わせている・issue #696）
 * 図柄は白。この紫（M3 Expressive へ更新したインディゴ・issue #705）と白のコントラストは6.4:1あり、32pxのfaviconでも枠が背景に沈まない。
 * 背景を淡い色に変える場合は、白のままだとコントラストが3.0を割るため図柄側も暗い色に戻す。
 */
export const APP_ICON_BACKGROUND = "#544fc1";
export const APP_ICON_FOREGROUND = "#ffffff";

/**
 * Koyomioのアプリアイコン。カレンダーの枠を白い線画で描き、線と点で日々の流れを表す
 * （issue #872。検討した3案のうち意匠③を採用）。
 *
 * 背景（APP_ICON_BACKGROUND）は含まず、線画だけを描く。198のviewBoxに対して図形は
 * 中央付近の約56〜63%だけを占めており、この余白込みの配置がそのままアイコンの余白になる。
 * 呼び出し側は size をそのまま容器のサイズに渡せばよく、縮小の掛け算は不要。
 */
export function AppIconGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 198 198" fill="none">
      <g stroke={APP_ICON_FOREGROUND} strokeLinecap="round" strokeLinejoin="round">
        <rect x="44" y="49" width="110" height="104" rx="9" strokeWidth="11" />
        <path d="M46 79h106" strokeWidth="10" />
        <path d="M69 39v22M129 39v22" strokeWidth="10" />
        <path d="M67 130h28v-29h34" strokeWidth="11" />
      </g>
      <circle cx="129" cy="101" r="10" fill={APP_ICON_FOREGROUND} />
    </svg>
  );
}
