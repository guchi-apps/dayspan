import { BottomNavSkeleton, SkeletonBlock } from "@/components/calendar/calendar-skeleton";

/**
 * 勤務の骨組み（docs/spec.md §33・issue #508）。
 *
 * この画面はNotionを読んでから描くため、置かないとルートの `loading.tsx` へ落ちて
 * 全面のブランド面が挟まる。下部ナビの1枠になったため、枠は `reminders/loading.tsx` と
 * 同じ形（メニューボタン風のヘッダー＋ `BottomNavSkeleton`）にする。
 */
export default function Loading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <SkeletonBlock className="size-8 rounded-full" />
        <SkeletonBlock className="h-6 w-16" />
        <span className="flex-1" />
      </div>

      <div className="h-1 w-full overflow-hidden bg-secondary-container">
        <div className="h-full w-2/5 animate-[linear-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
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

      <BottomNavSkeleton />
    </div>
  );
}
