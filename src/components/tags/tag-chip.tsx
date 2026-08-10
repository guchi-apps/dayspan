import { cn } from "@/lib/utils";
import type { TagColor, TagOption } from "@/services/notion/tag-options";

import { tagChipClass, tagColorOf } from "./tag-color";

/** タグ1つぶんの表示。一覧・詳細・入力欄のどこでも同じ形で出す。 */
export function TagChip({
  name,
  color,
  className,
}: {
  name: string;
  color: TagColor;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "type-label-medium inline-flex max-w-full items-center rounded-md px-1.5 py-0.5",
        // 長い名前で行が崩れないよう、チップの側で切り詰める。
        "min-w-0 truncate",
        tagChipClass(color),
        className,
      )}
    >
      {name}
    </span>
  );
}

/** 名前の配列をそのままチップの列にする。色は登録済みの選択肢から引く。 */
export function TagChipList({
  names,
  options,
  className,
}: {
  names: string[];
  options: TagOption[];
  className?: string;
}) {
  if (names.length === 0) return null;

  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)}>
      {names.map((name) => (
        <TagChip key={name} name={name} color={tagColorOf(options, name)} />
      ))}
    </span>
  );
}
