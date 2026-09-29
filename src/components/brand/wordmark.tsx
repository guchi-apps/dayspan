import { AppIconGlyph } from "@/lib/app-icon-glyph";
import { cn } from "@/lib/utils";

/**
 * YoteiFlow のワードマーク（issue #890・採用案「Soft Flow」）。
 * アイコンを左、`Yotei`（濃紺）と `Flow`（ブランド紫）を右に並べ、Flow の下に紫から暖色へ移る
 * 曲線を引く。曲線はアイコン内のルートを連想させるもので、`compact` では細部に頼らず
 * 名称の読みやすさを優先して省く。
 *
 * 文字は既に全体へ同梱している Noto Sans JP（太字・字間を詰める）をそのまま使う。
 * アウトライン化した別のSVGを持つと、字形が2通りになるうえ、そのための新しい道具が要る。
 * 大きさは親の font-size に追従する（`size` はアイコンの一辺のpx）。
 */
export function Wordmark({
  size = 28,
  compact = false,
  className,
}: {
  size?: number;
  /** 曲線を出さない。ヘッダー・ドロワーなど小さい面で使う。 */
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold tracking-[-0.05em]", className)}>
      <AppIconGlyph size={size} tile />
      <span className="relative inline-block leading-none whitespace-nowrap">
        {/* 濃紺はダークでは沈むため、Yotei だけテーマの文字色へ切り替える（Flow の紫も淡い紫へ） */}
        <span className="text-[#292640] dark:text-on-surface">Yotei</span>
        <span className="text-primary">Flow</span>
        {!compact && (
          <svg
            aria-hidden="true"
            viewBox="0 0 120 12"
            preserveAspectRatio="none"
            className="absolute -bottom-[0.28em] right-0 h-[0.2em] w-[52%]"
          >
            <defs>
              <linearGradient id="wordmark-flow-line">
                <stop stopColor="#544FC1" />
                <stop offset="1" stopColor="#E6AA7F" />
              </linearGradient>
            </defs>
            <path
              d="M4 6c14 4 26 4 40 0s24-4 36-1"
              fill="none"
              stroke="url(#wordmark-flow-line)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <circle cx="108" cy="5" r="4" fill="#E6AA7F" />
          </svg>
        )}
      </span>
    </span>
  );
}
