import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";

/**
 * 場所の骨組み（docs/spec.md §33）。
 *
 * この画面はNotionを読んでから描くため、置かないとルートの `loading.tsx` へ落ちて
 * 全面のブランド面が挟まる。枠は `SettingsShell` と同じ形にして、開いた瞬間に
 * 戻る先とタイトルの位置が動かないようにする。
 */
export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        <SkeletonBlock className="h-8 w-20 rounded-full" />
        <SkeletonBlock className="h-6 w-16" />
      </header>

      <div className="h-1 w-full overflow-hidden bg-secondary-container">
        <div className="h-full w-2/5 animate-[linear-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <SkeletonBlock className="h-11 w-full rounded-full" />

        <div className="flex flex-col gap-4 rounded-xl bg-surface-container-low p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <SkeletonBlock className="h-4 w-28" />
              <SkeletonBlock className="h-3 w-48" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
