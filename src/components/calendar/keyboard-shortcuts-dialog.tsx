"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/**
 * カレンダー画面のキーボードショートカット一覧（issue #635）。
 *
 * `?` キーとヘッダーのキーボードアイコンの両方から開く。Esc・? 自体は既存のRadix Dialogの
 * 挙動・このダイアログを開く操作そのものなので、ここには表示するだけで新たな実装は無い。
 */
const SHORTCUT_GROUPS: { label: string; rows: { keys: string[]; op: string }[] }[] = [
  {
    label: "移動",
    rows: [
      { keys: ["t"], op: "今日へ移動" },
      { keys: ["←"], op: "前の期間へ" },
      { keys: ["→"], op: "次の期間へ" },
    ],
  },
  {
    label: "表示形式",
    rows: [
      { keys: ["1"], op: "1日表示" },
      { keys: ["3"], op: "3日表示" },
      { keys: ["w"], op: "週表示" },
      { keys: ["m"], op: "月表示" },
    ],
  },
  {
    label: "操作",
    rows: [
      { keys: ["c"], op: "新規作成ダイアログを開く" },
      { keys: ["r"], op: "再取得" },
      { keys: ["Esc"], op: "開いているダイアログを閉じる" },
      { keys: ["?"], op: "このダイアログを開く" },
    ],
  },
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-3 overflow-y-auto sm:max-w-sm">
        <DialogTitle>キーボードショートカット</DialogTitle>
        <DialogDescription>
          カレンダー画面で使えます。入力欄にフォーカスがあるときや、ダイアログを開いているときは無効です。
        </DialogDescription>

        <div className="flex flex-col gap-3">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1 border-t border-outline-variant pt-3 first:border-t-0 first:pt-0">
              <span className="type-label-small text-on-surface-variant">{group.label}</span>
              {group.rows.map((row) => (
                <div
                  key={row.op}
                  className="flex items-center justify-between gap-3 py-0.5"
                >
                  <span className="type-body-medium">{row.op}</span>
                  <span className="flex shrink-0 gap-1">
                    {row.keys.map((key) => (
                      <kbd
                        key={key}
                        className="type-label-small flex h-6 min-w-6 items-center justify-center rounded-sm border border-outline-variant bg-surface-container-lowest px-1.5 font-mono text-on-surface"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
