/**
 * 文字を打つ入力欄かどうか。
 *
 * キーボードショートカットを発火させない判定（`use-calendar-shortcuts.ts`）と、iOSのキーボードが
 * 文書をずらしたまま残す件の判定（`stranded-scroll-reset.tsx`・issue #899）で同じ範囲を使う。
 */
export function isTextInput(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
