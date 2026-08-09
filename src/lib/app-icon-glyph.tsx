/**
 * DaySpanのアプリアイコン。カレンダー枠の中に「1日分の時間帯（span）」を表す縦棒を置き、
 * 月表示と時間グリッドを併せ持つアプリであることを示す。
 */
export function AppIconGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4.5" width="18" height="16.5" rx="3" fill="#fafafa" />
      <rect x="7" y="2" width="2" height="4.5" rx="1" fill="#fafafa" />
      <rect x="15" y="2" width="2" height="4.5" rx="1" fill="#fafafa" />
      <rect x="6" y="9.5" width="4.5" height="8" rx="1.5" fill="#171717" />
      <rect x="13.5" y="9.5" width="4.5" height="4" rx="1.5" fill="#171717" />
    </svg>
  );
}
