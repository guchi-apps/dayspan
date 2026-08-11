"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectionStatusBadge } from "@/components/settings/connection-status-badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  TASK_FIELD_REQUIREMENTS,
  type DataSourceSummary,
  type PropertyMap,
  type SharedPageSummary,
} from "@/services/notion/task-database";
import {
  PLACE_FIELD_REQUIREMENTS,
  type PlacePropertyMap,
} from "@/services/notion/place-database";
import {
  REMINDER_FIELD_REQUIREMENTS,
  type ReminderPropertyMap,
} from "@/services/notion/reminder-database";

type MissingProperty = { field: string; label: string; types: string[] };

/** 新規作成できるDB。作成の手順は同じで、APIの経路と既定名だけが違う。 */
type DatabaseKind = "task" | "place";

const DATABASE_LABELS: Record<DatabaseKind, string> = {
  task: "タスクDB",
  place: "場所DB",
};

const DATABASE_DEFAULT_TITLES: Record<DatabaseKind, string> = {
  task: "DaySpan タスク",
  place: "DaySpan 場所",
};

/** Notionが返したメッセージがあればそれを見せる。原因が分からないまま止まらないようにする。 */
async function errorText(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ? `${fallback}（${body.message}）` : fallback;
  } catch {
    return fallback;
  }
}

export type NotionSectionState = {
  connected: boolean;
  workspaceName: string | null;
  taskDataSourceId: string | null;
  taskTitle: string | null;
  propertyMap: PropertyMap | null;
  reminderDataSourceId: string | null;
  reminderTitle: string | null;
  reminderPropertyMap: ReminderPropertyMap | null;
  placeDataSourceId: string | null;
  placeTitle: string | null;
  placePropertyMap: PlacePropertyMap | null;
  dataSources: DataSourceSummary[];
  sharedPages: SharedPageSummary[];
  dataSourcesFailed: boolean;
};

export function NotionSection({ state }: { state: NotionSectionState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [missing, setMissing] = useState<MissingProperty[] | null>(null);
  const [busy, setBusy] = useState(false);
  // 新規作成はタスクDBと場所DBで同じ手順のため、どちらを作るかだけを持つ。
  const [creating, setCreating] = useState<DatabaseKind | null>(null);
  const [newDatabaseTitle, setNewDatabaseTitle] = useState("");
  const [parentPageId, setParentPageId] = useState("");

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        setMessage({ text: "トークンが正しくないか、権限がありません。", tone: "error" });
        return;
      }

      setToken("");
      setMessage({ text: "Notionに接続しました。タスクDBを選択してください。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await fetch("/api/notion/connect", { method: "DELETE" });
      setMissing(null);
      setMessage(null);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/task-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });

      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({ text: "タスクDBを設定できませんでした。", tone: "error" });
        return;
      }

      setMessage({ text: "タスクDBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectReminderDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/reminder-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "日付リマインドDBに必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({ text: "日付リマインドDBを設定できませんでした。", tone: "error" });
        return;
      }
      setMessage({ text: "日付リマインドDBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const selectPlaceDataSource = async (dataSourceId: string) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/place-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSourceId }),
      });
      if (response.status === 422) {
        const body = (await response.json()) as { missingRequired: MissingProperty[] };
        setMissing(body.missingRequired);
        setMessage({ text: "場所DBに必要なプロパティが不足しています。", tone: "error" });
        return;
      }
      if (!response.ok) {
        setMessage({ text: await errorText(response, "場所DBを設定できませんでした。"), tone: "error" });
        return;
      }
      setMessage({ text: "場所DBを設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const createDatabase = async (kind: DatabaseKind) => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    const label = DATABASE_LABELS[kind];
    try {
      const response = await fetch(`/api/notion/${kind}-database/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPageId, title: newDatabaseTitle }),
      });

      if (!response.ok) {
        setMessage({ text: await errorText(response, `${label}を作成できませんでした。`), tone: "error" });
        return;
      }

      setCreating(null);
      setMessage({ text: `${label}を作成して設定しました。`, tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const startCreating = (kind: DatabaseKind) => {
    setCreating(kind);
    setNewDatabaseTitle(DATABASE_DEFAULT_TITLES[kind]);
  };

  const disabled = busy || pending;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {message && (
          <p
            className={
              message.tone === "ok"
                ? "type-body-medium text-on-surface-variant"
                : "type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container"
            }
          >
            {message.text}
          </p>
        )}

        {!state.connected ? (
          <div className="flex flex-col gap-3">
            <ConnectionStatusBadge tone="not_connected">未接続</ConnectionStatusBadge>
            <div className="flex flex-col gap-2">
              <Input
                id="notion-token"
                label="Integration Token"
                type="password"
                autoComplete="off"
                placeholder="ntn_..."
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Notionで作成したInternal Integrationのトークンです。対象のタスクDBに、そのIntegrationを接続しておいてください。
              </p>
            </div>
            <Button className="w-fit" disabled={!token.trim() || disabled} onClick={connect}>
              接続する
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="type-body-large truncate font-medium">
                  {state.workspaceName ?? "接続済み"}
                </span>
                <ConnectionStatusBadge tone="connected">接続済み</ConnectionStatusBadge>
              </div>
              <Button variant="ghost" size="sm" disabled={disabled} onClick={disconnect}>
                接続を解除
              </Button>
            </div>

            {state.taskDataSourceId && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary">タスクDB</Badge>
                  <span className="font-medium">{state.taskTitle}</span>
                </div>
                {state.propertyMap && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {TASK_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.propertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}

            {missing && missing.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg bg-error-container/70 p-3 text-on-error-container">
                <p className="type-body-medium font-medium">
                  次のプロパティをNotion側に追加してください
                </p>
                <ul className="type-body-small list-disc pl-5">
                  {missing.map((item) => (
                    <li key={item.field}>
                      {item.label}（{item.types.join(" または ")}）
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">タスクDBを選択</span>
              <p className="text-xs text-muted-foreground">
                Notion側にプロパティを足したときは、同じDBをもう一度選ぶと対応が更新されます。
              </p>

              {state.dataSourcesFailed && (
                <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
                  Notionからデータベース一覧を取得できませんでした。トークンを確認してください。
                </p>
              )}

              {!state.dataSourcesFailed && state.dataSources.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Integrationに共有されているデータベースがありません。Notion側でタスクDBに接続を許可してください。
                </p>
              )}

              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={
                        state.taskDataSourceId === dataSource.dataSourceId ? "secondary" : "outline"
                      }
                      size="sm"
                      disabled={disabled}
                      onClick={() => selectDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">日付リマインドDBを選択</span>
              <p className="text-xs text-muted-foreground">
                記念日や更新日など、完了して消化するものではない日付を管理します。タイトルと日付が必要です。
              </p>
              {state.reminderDataSourceId && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">日付リマインドDB</Badge>
                    <span className="font-medium">{state.reminderTitle}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {REMINDER_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.reminderPropertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={state.reminderDataSourceId === dataSource.dataSourceId ? "secondary" : "outline"}
                      size="sm"
                      disabled={disabled || state.taskDataSourceId === dataSource.dataSourceId}
                      onClick={() => selectReminderDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">場所DBを選択</span>
              <p className="text-xs text-muted-foreground">
                よく行く場所を管理します。予定の「場所」欄に入力候補として出ます。名前が必要で、住所とタグは任意です。
              </p>
              {state.placeDataSourceId && (
                <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Badge variant="secondary">場所DB</Badge>
                    <span className="font-medium">{state.placeTitle}</span>
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {PLACE_FIELD_REQUIREMENTS.map((requirement) => (
                      <div key={requirement.field} className="contents">
                        <dt>{requirement.label}</dt>
                        <dd>{state.placePropertyMap?.[requirement.field] ?? "未対応"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              <ul className="flex flex-wrap gap-2">
                {state.dataSources.map((dataSource) => (
                  <li key={dataSource.dataSourceId}>
                    <Button
                      variant={state.placeDataSourceId === dataSource.dataSourceId ? "secondary" : "outline"}
                      size="sm"
                      disabled={
                        disabled ||
                        state.taskDataSourceId === dataSource.dataSourceId ||
                        state.reminderDataSourceId === dataSource.dataSourceId
                      }
                      onClick={() => selectPlaceDataSource(dataSource.dataSourceId)}
                    >
                      {dataSource.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              {!creating ? (
                <div className="flex flex-wrap gap-2">
                  {(["task", "place"] as const).map((kind) => (
                    <Button
                      key={kind}
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      disabled={disabled}
                      onClick={() => startCreating(kind)}
                    >
                      <Plus className="size-4" />
                      {DATABASE_LABELS[kind]}を新規作成
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    必要なプロパティを揃えた{DATABASE_LABELS[creating]}をNotionに作成します。作成先のページは、
                    このConnectionに共有されているものから選べます。
                  </p>

                  <Input
                    id="new-database-title"
                    label="データベース名"
                    value={newDatabaseTitle}
                    onChange={(event) => setNewDatabaseTitle(event.target.value)}
                  />

                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">作成先のページ</span>
                    {state.sharedPages.length === 0 ? (
                      <p className="text-xs text-destructive">
                        共有されているページがありません。Notionで任意のページを開き、
                        ••• →「接続」からこのConnectionを追加してください。
                      </p>
                    ) : (
                      <ul className="flex flex-wrap gap-2">
                        {state.sharedPages.map((page) => (
                          <li key={page.pageId}>
                            <Button
                              variant={parentPageId === page.pageId ? "secondary" : "outline"}
                              size="sm"
                              disabled={disabled}
                              onClick={() => setParentPageId(page.pageId)}
                            >
                              {page.title}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={disabled || !parentPageId || !newDatabaseTitle.trim()}
                      onClick={() => createDatabase(creating)}
                    >
                      作成する
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setCreating(null)}
                    >
                      やめる
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
