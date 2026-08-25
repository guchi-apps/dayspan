import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";

/**
 * 勤務の骨組み（docs/spec.md §33）。
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
        <div className="flex items-center justify-between">
          <SkeletonBlock className="h-8 w-8 rounded-full" />
          <SkeletonBlock className="h-5 w-24" />
          <SkeletonBlock className="h-8 w-8 rounded-full" />
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-4 w-28" />
          <div className="flex gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonBlock key={i} className="h-9 w-20 rounded-full" />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <SkeletonBlock className="h-3 w-12" />
              <SkeletonBlock className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
