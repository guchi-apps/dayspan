import { Wifi } from "lucide-react";

/**
 * 通信が遅く、Service Workerがタイムアウトで保存済みの内容を代わりに返しているときの帯
 * （issue #718）。
 *
 * `OfflineNotice` とは別のコンポーネントにする。オフラインではなく実際に繋がっているため、
 * 同じ文言・同じ色で「オフラインです」と出すと誤りになる。オフラインとは違う色・違うアイコンで、
 * 「遅いだけで繋がっている」ことが伝わるようにする。
 */
export function SlowNetworkNotice() {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-1.5 bg-secondary-container px-3 py-2 text-xs text-on-secondary-container"
    >
      <Wifi className="size-4 shrink-0" />
      <span>通信が遅いため、保存済みの内容を表示しています。</span>
    </div>
  );
}
