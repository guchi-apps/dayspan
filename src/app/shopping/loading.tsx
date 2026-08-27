import { BottomNavSkeleton, SkeletonBlock } from "@/components/calendar/calendar-skeleton";

/**
 * 買い物リストの骨組み（docs/spec.md §36）。
 *
 * この画面はNotionへ取りにいくため、下部ナビから移ったときに待ちが入る。独自の骨組みを
 * 持たせないと、根の loading.tsx（面とプログレスバーだけ）に落ちる。
 */
export default function Loading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <SkeletonBlock className="size-8 rounded-full" />
        <span className="flex-1" />
        <SkeletonBlock className="h-8 w-20 rounded-full" />
        <SkeletonBlock className="h-8 w-8 rounded-full" />
      </div>

      <div className="h-1 w-full overflow-hidden bg-secondary-container">
        <div className="h-full w-2/5 animate-[linear-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>

      {/* カテゴリのタブ。件数はDBによって違うため、幅を揃えず3つだけ置く。 */}
      <div className="flex gap-2 border-b border-rule bg-surface-container-low px-3 pt-1 pb-2">
        <SkeletonBlock className="h-7 w-20 rounded-full" />
        <SkeletonBlock className="h-7 w-16 rounded-full" />
        <SkeletonBlock className="h-7 w-24 rounded-full" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {/* カテゴリの見出しと、その下に並ぶ項目。件数はカテゴリによって違う。 */}
        {Array.from({ length: 3 }, (_, section) => (
          <div key={section}>
            <div className="border-b border-rule px-3 py-1.5">
              <SkeletonBlock className="h-3 w-16" />
            </div>
            {Array.from({ length: section === 1 ? 2 : 3 }, (_, row) => (
              <div key={row} className="flex items-start gap-2 py-2 pr-3 pl-2">
                <SkeletonBlock className="size-4 rounded-xs" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <SkeletonBlock className="h-4 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      <BottomNavSkeleton />
    </div>
  );
}
