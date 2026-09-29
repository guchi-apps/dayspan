import { useId } from "react";

/**
 * アプリアイコンの配色。favicon・apple-icon・PWAアイコンの5箇所で同じ色を使うため、
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
 * YoteiFlowのアプリアイコン（issue #890。原本は assets/brand/yoteiflow-icon.svg の Flow Ribbon 案）。
 * 白いカレンダーの上を、紫から暖色へ続く曲線が通り、予定の流れを表す。
 *
 * 既定は背景を含めず図柄だけを描く。呼び出し側が APP_ICON_BACKGROUND の面に置く（起動画面）。
 * `tile` を付けると、同じ紫の角丸の器ごと描く（ワードマークのように地が紫でない場所）。
 * 図柄の座標は原本の256のviewBoxのまま。ファイルの書き出し（PNG）は原本SVGから
 * scripts/generate-brand-assets.sh が行うため、ここを変えたら原本とそろえること。
 * グラデーション・フィルタのidは、同じ画面に複数置かれても衝突しないよう useId で分ける
 * （表示を消した側のSVGにあるidを参照すると描かれないブラウザがあるため）。
 */
export function AppIconGlyph({ size, tile = false }: { size: number; tile?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const paper = `paper-${uid}`;
  const ribbon = `ribbon-${uid}`;
  const shadow = `shadow-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <defs>
        <linearGradient id={paper} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#E9E7FF" />
        </linearGradient>
        <linearGradient id={ribbon} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#4A42B9" />
          <stop offset=".52" stopColor="#8173ED" />
          <stop offset="1" stopColor="#E5A879" />
        </linearGradient>
        <filter id={shadow} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="9" stdDeviation="9" floodColor="#241C73" floodOpacity=".32" />
        </filter>
      </defs>
      {tile && <rect width="256" height="256" rx="56" fill={APP_ICON_BACKGROUND} />}
      <g filter={`url(#${shadow})`}>
        <rect x="43" y="46" width="170" height="166" rx="23" fill={`url(#${paper})`} />
        <path d="M43 87h170" stroke="#D7D2F8" strokeWidth="4" />
        <path d="M83 36v29M173 36v29" stroke="#FFFFFF" strokeWidth="13" strokeLinecap="round" />
      </g>
      <g fill="none" strokeLinecap="round">
        <path
          d="M74 168C94 174 100 139 121 143S147 168 165 131S185 122 192 107"
          stroke="#CFC8F8"
          strokeWidth="25"
          opacity=".58"
        />
        <path
          d="M74 168C94 174 100 139 121 143S147 168 165 131S185 122 192 107"
          stroke={`url(#${ribbon})`}
          strokeWidth="15"
        />
      </g>
      <circle cx="74" cy="168" r="11" fill="#5148BA" stroke="#FFFFFF" strokeWidth="5" />
      <circle cx="192" cy="107" r="12" fill="#F2BA8B" stroke="#FFFFFF" strokeWidth="5" />
      <path d="M69 190h80" stroke="#CCC7F4" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}
