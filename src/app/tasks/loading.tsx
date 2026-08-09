import { SkeletonBlock } from "@/components/calendar/calendar-skeleton";

export default function Loading() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <SkeletonBlock className="h-6 w-20" />
        <span className="flex-1" />
        <SkeletonBlock className="h-8 w-20 rounded-full" />
      </div>

      <div className="h-1 w-full overflow-hidden bg-secondary-container">
        <div className="h-full w-2/5 animate-[linear-progress_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {Array.from({ length: 3 }, (_, section) => (
          <div key={section}>
            <div className="bg-surface-container px-4 py-2">
              <SkeletonBlock className="h-4 w-16" />
            </div>
            {Array.from({ length: 3 }, (_, row) => (
              <div key={row} className="flex items-start gap-3 px-4 py-3">
                <SkeletonBlock className="size-4 rounded-xs" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <SkeletonBlock className="h-4 w-2/3" />
                  <SkeletonBlock className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
