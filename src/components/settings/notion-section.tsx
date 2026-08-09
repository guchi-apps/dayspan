"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  TASK_FIELD_REQUIREMENTS,
  type DataSourceSummary,
  type PropertyMap,
  type SharedPageSummary,
} from "@/services/notion/task-database";

type MissingProperty = { field: string; label: string; types: string[] };

export type NotionSectionState = {
  connected: boolean;
  workspaceName: string | null;
  taskDataSourceId: string | null;
  taskTitle: string | null;
  propertyMap: PropertyMap | null;
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
  const [creating, setCreating] = useState(false);
  const [newDatabaseTitle, setNewDatabaseTitle] = useState("DaySpan タスク");
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

  const createTaskDatabase = async () => {
    setBusy(true);
    setMissing(null);
    setMessage(null);
    try {
      const response = await fetch("/api/notion/task-database/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPageId, title: newDatabaseTitle }),
      });

      if (!response.ok) {
        setMessage({ text: "タスクDBを作成できませんでした。", tone: "error" });
        return;
      }

      setCreating(false);
      setMessage({ text: "タスクDBを作成して設定しました。", tone: "ok" });
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || pending;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {message && (
          <p
            className={
              message.tone === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"
            }
          >
            {message.text}
          </p>
        )}

        {!state.connected ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="notion-token">Integration Token</Label>
              <Input
                id="notion-token"
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
              <span className="text-sm font-medium">{state.workspaceName ?? "接続済み"}</span>
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
              <div className="flex flex-col gap-1 rounded-lg bg-destructive/10 p-3 text-sm">
                <p className="font-medium">次のプロパティをNotion側に追加してください</p>
                <ul className="list-disc pl-5 text-xs">
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

              {state.dataSourcesFailed && (
                <p className="text-sm text-destructive">
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
              {!creating ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={disabled}
                  onClick={() => setCreating(true)}
                >
                  <Plus className="size-4" />
                  タスクDBを新規作成
                </Button>
              ) : (
                <div className="flex flex-col gap-3 rounded-lg bg-muted/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    必要なプロパティを揃えたタスクDBをNotionに作成します。作成先のページは、
                    このConnectionに共有されているものから選べます。
                  </p>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="new-database-title">データベース名</Label>
                    <Input
                      id="new-database-title"
                      value={newDatabaseTitle}
                      onChange={(event) => setNewDatabaseTitle(event.target.value)}
                    />
                  </div>

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
                      onClick={createTaskDatabase}
                    >
                      作成する
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setCreating(false)}
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
