"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { ArrowUpDown, Eye, EyeOff, Plus, RefreshCw, ShoppingCart } from "lucide-react";

import { readErrorMessage } from "@/components/calendar/response-error";
import { AppMenuButton } from "@/components/nav/app-drawer";
import { BottomNav } from "@/components/nav/main-nav";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { ShoppingItemDialog, type ShoppingDraft } from "@/components/shopping/shopping-item-dialog";
import { useShoppingViewPrefs } from "@/components/shopping/use-shopping-view-prefs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LinearProgress } from "@/components/ui/linear-progress";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import {
  buildShoppingSections,
  categoryLabelOf,
  SHOPPING_SORTS,
  SHOPPING_SORT_LABELS,
  shoppingCategoryKeys,
  unboughtCounts,
  type ShoppingItem,
} from "@/types/shopping";

/**
 * 買い物リストの画面（docs/spec.md §36）。
 *
 * 一次情報源はNotionの買い物リストDBで、DaySpanのDBには何も保存しない。別アプリ
 * （shopping-list）と同じDBを指せるため、どちらから足したものも両方に出る。
 */
export function ShoppingScreen({
  items,
  categoryOptions,
  timeZone,
  loadError,
  activityRunning = false,
}: {
  items: ShoppingItem[];
  /** 登録済みのカテゴリ。タブの並び順もこの定義順に従う。 */
  categoryOptions: TagOption[];
  /** ナビの「カレンダー」が今日へ移るのに使う（端末の時計任せにしない）。 */
  timeZone: string;
  loadError: string | null;
  /** 活動を記録中かどうか。ナビの記録の項目へ印を出すためだけに使う（docs/spec.md §27）。 */
  activityRunning?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { sort, showBought, setSort, setShowBought } = useShoppingViewPrefs();
  const [filterKey, setFilterKey] = useState("all");
  const [dialog, setDialog] = useState<ShoppingDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 購入済みの切り替えは押した瞬間に画面へ反映する。買い物中はいちばん押す操作で、
  // Notionへの往復（1秒前後）を待たせると、次の棚へ移りながら押すことができない。
  const [pendingBought, setPendingBought] = useState<Record<string, boolean>>({});

  // オフライン中は書き込みを止める（docs/spec.md §21）。
  const offline = useOffline();
  useReconnectRefresh();

  // オフラインでこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  // ナビからの移動はソフトナビゲーションで、Service Worker が保存できないため。
  useWarmOfflinePage("/shopping");

  const categoryNames = useMemo(
    () => categoryOptions.map((option) => option.name),
    [categoryOptions],
  );

  // 楽観更新ぶんを重ねた一覧。以降の集計・区分はすべてこれを見る。
  const shown = useMemo(
    () =>
      items.map((item) =>
        item.id in pendingBought ? { ...item, bought: pendingBought[item.id] } : item,
      ),
    [items, pendingBought],
  );

  const tabKeys = useMemo(
    () => shoppingCategoryKeys(shown, categoryNames),
    [shown, categoryNames],
  );
  const counts = useMemo(() => unboughtCounts(shown), [shown]);

  // 選んでいたカテゴリが（Notion側での削除・改名で）無くなったら「すべて」へ戻す。
  // 残したままだと、どのタブも押していないのに一覧が空の画面になる。
  const activeKey = filterKey === "all" || tabKeys.includes(filterKey) ? filterKey : "all";

  const sections = useMemo(
    () => buildShoppingSections(shown, categoryNames, { filterKey: activeKey, sort, showBought }),
    [shown, categoryNames, activeKey, sort, showBought],
  );

  const hasBought = shown.some((item) => item.bought);

  /**
   * 購入済みの切り替え。
   *
   * 先に画面を変え、Notionへの書き込みが失敗したら押す前へ戻す。戻したことが分かるよう
   * 失敗の理由も出す（黙って戻ると、押したはずのチェックが外れた理由が読めない）。
   */
  const toggleBought = async (item: ShoppingItem, bought: boolean) => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setPendingBought((prev) => ({ ...prev, [item.id]: bought }));
    setBusyId(item.id);
    setError(null);
    try {
      const response = await fetch(`/api/shopping/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bought }),
      });
      if (!response.ok) {
        setPendingBought((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setError(await readErrorMessage(response, "購入済みを変更できませんでした。"));
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setPendingBought((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setError("購入済みを変更できませんでした。");
    } finally {
      setBusyId(null);
    }
  };

  const openAdd = () => {
    // 追加の既定は開いているタブのカテゴリ。「すべて」を見ているときだけ未設定から始める
    // （そこには「いま何のカテゴリを足そうとしているか」の手掛かりが無い）。
    setDialog({ mode: "create", category: activeKey === "all" ? null : activeKey });
  };

  const nextSort = () => setSort(SHOPPING_SORTS[(SHOPPING_SORTS.indexOf(sort) + 1) % SHOPPING_SORTS.length]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-2 py-2">
        {/* どの画面幅でも左上をメニューにする（issue #328・#463）。画面の移動はすべてここから。 */}
        <AppMenuButton current="shopping" activityRunning={activityRunning} />
        {/* いまどの画面にいるかは、ヘッダーのナビが無くなったぶんここで示す（issue #463）。
            狭い画面では下部ナビが同じことを示すため、PCだけに出す。 */}
        <div className="hidden shrink-0 items-center gap-1.5 font-semibold md:flex">
          <ShoppingCart className="size-5" />
          <span>買い物</span>
        </div>

        <span className="flex-1" />

        {hasBought && (
          <Button
            variant="outline"
            size="sm"
            aria-label={showBought ? "購入したものを隠す" : "購入したものを表示する"}
            onClick={() => setShowBought(!showBought)}
          >
            {showBought ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            <span className="hidden sm:inline">購入済み</span>
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label={`並び替え（いまは${SHOPPING_SORT_LABELS[sort]}）`}
          onClick={nextSort}
        >
          <ArrowUpDown className="size-4" />
          {SHOPPING_SORT_LABELS[sort]}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="再取得"
          // オフライン中に押しても、再接続まで終わらない読み込みが始まるだけになる。
          disabled={pending || offline}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>

      <LinearProgress active={pending || busyId !== null} />

      <OfflineNotice />

      {(loadError || error) && (
        <div className="bg-error-container/70 px-3 py-2 text-xs text-on-error-container">
          {loadError ?? error}
        </div>
      )}

      {/* カテゴリのタブ。数字は未購入の件数で、押す前に残りの多い売り場が分かる。
          並び順はNotionのプロパティ定義そのもの（そこが一次情報源）。 */}
      {tabKeys.length > 0 && (
        <div
          role="tablist"
          aria-label="カテゴリ"
          className="flex shrink-0 gap-2 overflow-x-auto border-b border-rule bg-surface-container-low px-3 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <CategoryTab
            active={activeKey === "all"}
            count={counts.all ?? 0}
            onClick={() => setFilterKey("all")}
          >
            すべて
          </CategoryTab>
          {tabKeys.map((key) => (
            <CategoryTab
              key={key}
              active={activeKey === key}
              count={counts[key] ?? 0}
              onClick={() => setFilterKey(key)}
            >
              {categoryLabelOf(key)}
            </CategoryTab>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
        {sections.map((section) => (
          <section key={section.key}>
            {/* カテゴリを選んでいるときは見出しを出さない。何のカテゴリかはタブが示している。 */}
            {activeKey === "all" && (
              <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-background/95 px-3 py-1 text-[11px] tracking-widest text-muted-foreground backdrop-blur">
                {section.label}
                <span className="text-[10px] opacity-70">{section.items.length}</span>
              </h2>
            )}

            <ul>
              {section.items.map((item) => (
                <ShoppingRow
                  key={item.id}
                  item={item}
                  disabled={busyId === item.id || offline}
                  onToggleBought={(bought) => toggleBought(item, bought)}
                  onOpen={() => setDialog({ mode: "edit", item })}
                />
              ))}
            </ul>
          </section>
        ))}

        {sections.length === 0 && !loadError && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {shown.length === 0
              ? "買うものがありません。"
              : showBought
                ? "このカテゴリに項目がありません。"
                : "買うものはありません。購入したものは隠しています。"}
          </p>
        )}
      </div>

      <Button
        size="icon"
        className="elevation-3 fixed right-4 bottom-[calc(6rem_+_env(safe-area-inset-bottom))] z-20 size-14 rounded-lg bg-primary-container text-on-primary-container hover:brightness-95 md:bottom-6"
        aria-label="買うものを追加"
        disabled={offline}
        onClick={openAdd}
      >
        <Plus className="size-6" />
      </Button>

      <BottomNav current="shopping" activityRunning={activityRunning} timeZone={timeZone} />

      {dialog && (
        <ShoppingItemDialog
          draft={dialog}
          categoryOptions={categoryOptions}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            // 楽観更新ぶんは取り直した値で置き換わる。残しておくと、削除した項目の
            // 購入済みだけが手元に残り続ける。
            setPendingBought({});
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function CategoryTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "type-label-large flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 transition-colors",
        active
          ? "border-transparent bg-secondary-container text-on-secondary-container"
          : "border-outline-variant text-on-surface-variant hover:bg-on-surface/8",
      )}
    >
      {children}
      <span className="type-label-small tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function ShoppingRow({
  item,
  disabled,
  onToggleBought,
  onOpen,
}: {
  item: ShoppingItem;
  disabled: boolean;
  onToggleBought: (bought: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <li className="flex items-start gap-2 border-b border-rule/50 py-1.5 pr-3 pl-2">
      <PriorityBar priority={item.priority} />

      <Checkbox
        className="mt-[3px]"
        checked={item.bought}
        disabled={disabled}
        aria-label={`${item.name} を購入済みにする`}
        onCheckedChange={(value) => onToggleBought(value === true)}
      />

      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div
          className={cn(
            "type-body-medium clip-nowrap",
            item.bought && "text-on-surface-variant line-through",
          )}
        >
          {item.name}
        </div>
        {item.memo && (
          <div className="type-label-small clip-nowrap font-normal text-on-surface-variant">
            {item.memo}
          </div>
        )}
      </button>
    </li>
  );
}

/**
 * 行の左端に出す優先度の帯。
 *
 * タスク画面（`task-list.tsx`）とまったく同じ形にする。同じアプリの中で同じ意味（急ぐかどうか）
 * が別の形で出ると、読むたびに対応づけ直すことになる。色だけに意味を持たせないよう、
 * 読み上げ用の文字を添える。
 */
function PriorityBar({ priority }: { priority: ShoppingItem["priority"] }) {
  const tone = priority === "高" ? "bg-destructive" : priority === "中" ? "bg-tertiary" : null;

  if (!tone) return <span className="w-[3px] shrink-0" aria-hidden />;

  return (
    <>
      <span className={cn("w-[3px] shrink-0 self-stretch rounded-full", tone)} aria-hidden />
      <span className="sr-only">優先度 {priority}</span>
    </>
  );
}
