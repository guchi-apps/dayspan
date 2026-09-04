import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";

/**
 * 年休の取得状況の骨組み。
 *
 * ルートの `loading.tsx` へ落とすと全面のアイコン（起動画面と同じ面）が挟まるため、
 * この画面の形をここに持つ（docs/spec.md §33）。枠は `SettingsShell` と同じ
 * 「戻るボタン付きのヘッダー」。
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
        <div className="flex items-center justify-between gap-2">
          <SkeletonBlock className="size-8 rounded-full" />
          <SkeletonBlock className="h-6 w-28" />
          <SkeletonBlock className="size-8 rounded-full" />
        </div>

        {/* 残り日数・ペース・月ごと・一覧の4枚。 */}
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-9 w-32" />
          <SkeletonBlock className="h-3.5 w-full rounded-sm" />
          <SkeletonBlock className="h-4 w-48" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-2 w-full rounded-full" />
          <SkeletonBlock className="h-2 w-full rounded-full" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl bg-surface-container-low p-4">
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="h-16 w-full" />
        </div>
      </div>
    </div>
  );
}
