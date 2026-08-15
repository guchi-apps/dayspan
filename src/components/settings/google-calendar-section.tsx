"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectionStatusBadge } from "@/components/settings/connection-status-badge";
import { readErrorMessage } from "@/components/calendar/response-error";
import { cn } from "@/lib/utils";
import type { CalendarSettingsResult } from "@/services/google-calendar/settings";

export function GoogleCalendarSection({
  result,
  connectResult,
}: {
  result: CalendarSettingsResult;
  connectResult?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busySettingId, setBusySettingId] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // 並べ替えは押した直後に反映する。サーバーから取り直すとGoogleへのカレンダー一覧の
  // 往復が挟まり、押してから動くまでが空いて効いていないように見えるため、
  // 順番だけは手元に持って先に描画し、保存はその裏で行う。
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);

  const calendars = useMemo(() => {
    const all = result.status === "ok" ? result.calendars : [];
    if (!orderedIds) return all;

    // 手元の並びに無いもの（この画面を開いた後にGoogle側で増えたカレンダー）は末尾へ回す。
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    const at = (settingId: string) => rank.get(settingId) ?? Number.MAX_SAFE_INTEGER;
    return [...all].sort((a, b) => at(a.settingId) - at(b.settingId));
  }, [result, orderedIds]);

  const calendarsOf = (googleAccountId: string) =>
    calendars.filter((calendar) => calendar.googleAccountId === googleAccountId);

  // 並べ替えの保存は前のものが終わってから次を送る。連続で押したときに
  // 応答の前後が入れ替わると、最後に押した並びで終わらないため。
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const saveOrder = async (googleAccountId: string, settingIds: string[]) => {
    try {
      const response = await fetch("/api/google/calendars/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleAccountId, settingIds }),
      });
      if (!response.ok) throw new Error(`order request failed: ${response.status}`);
    } catch {
      // 保存できていないのに画面だけ並び替わったままにしない。手元の並びは捨て、
      // 保存されている並びを取り直して見せる。
      setOrderedIds(null);
      setOrderError("表示順を保存できませんでした。");
      startTransition(() => router.refresh());
    }
  };

  /** 同じアカウントの中で、カレンダーを1つ上（-1）・下（+1）へ動かす。 */
  const move = (googleAccountId: string, settingId: string, delta: number) => {
    const group = calendarsOf(googleAccountId).map((calendar) => calendar.settingId);

    const from = group.indexOf(settingId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= group.length) return;
    [group[from], group[to]] = [group[to], group[from]];

    // 画面には複数アカウントのカレンダーが並ぶ。動かしたアカウントの分だけ差し替える。
    let cursor = 0;
    const next = calendars.map((calendar) =>
      calendar.googleAccountId === googleAccountId ? group[cursor++] : calendar.settingId,
    );

    setOrderedIds(next);
    setOrderError(null);
    saveQueue.current = saveQueue.current.then(() => saveOrder(googleAccountId, group));
  };

  const updateSetting = async (
    settingId: string,
    patch: { visible?: boolean; writeEnabled?: boolean; isCreateDefault?: boolean },
  ) => {
    setBusySettingId(settingId);
    setUpdateError(null);
    try {
      const response = await fetch("/api/google/calendars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settingId, ...patch }),
      });
      if (response.ok) {
        startTransition(() => router.refresh());
        return;
      }
      // 断られたときにチップが黙って元へ戻ると、押せていないのか設定できないのかが分からない。
      setUpdateError(await readErrorMessage(response, "設定を変更できませんでした。"));
    } catch {
      setUpdateError("設定を変更できませんでした。");
    } finally {
      setBusySettingId(null);
    }
  };

  const disconnect = async (googleAccountId: string) => {
    await fetch("/api/google/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ googleAccountId }),
    });
    startTransition(() => router.refresh());
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {connectResult && <ConnectResultMessage result={connectResult} />}

        {result.status === "not_connected" && (
          <div className="flex flex-col gap-3">
            <ConnectionStatusBadge tone="not_connected">未接続</ConnectionStatusBadge>
            <p className="type-body-medium text-on-surface-variant">まだ接続されていません。</p>
            <Button asChild className="w-fit">
              <a href="/api/google/connect">Google Calendarを接続する</a>
            </Button>
          </div>
        )}

        {result.status === "reauth_required" && (
          <div className="flex flex-col gap-3">
            <ConnectionStatusBadge tone="attention">要再接続</ConnectionStatusBadge>
            <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
              {result.accountEmail} の認可が失効しました。接続をやり直してください。
            </p>
            <Button asChild className="w-fit">
              <a href="/api/google/connect">再接続する</a>
            </Button>
          </div>
        )}

        {result.status === "ok" && (
          <div className="flex flex-col gap-5">
            <div className="type-body-small flex flex-col gap-1 rounded-lg bg-surface-container px-3 py-2 text-on-surface-variant">
              <p>
                <span className="font-medium text-on-surface">表示</span>
                はカレンダー画面に予定を出すかどうか、
                <span className="font-medium text-on-surface">使用</span>
                はそのカレンダーへ書き込んでよいかどうかです。使用がオフのカレンダーには、DaySpanの画面からも外部アプリからも書き込みません。
              </p>
              <p>
                上下の矢印で並べ替えます。ここでの並びは、予定の入力画面に出る保存先カレンダーの
                並び順にも使われます。
              </p>
            </div>

            {(orderError || updateError) && (
              <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
                {orderError ?? updateError}
              </p>
            )}

            {result.accounts.map((account) => (
              <div key={account.id} className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="type-body-large truncate font-medium">{account.email}</span>
                    <ConnectionStatusBadge tone="connected">接続済み</ConnectionStatusBadge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => disconnect(account.id)}
                  >
                    連携を解除
                  </Button>
                </div>

                {/*
                  カレンダー1つを1枚の枠にする。名前と並べ替えを上段、選択を下段に固定すると、
                  名前が長くても操作が行をまたがず、どれがどのカレンダーの操作か分かる。
                */}
                <ul className="flex flex-col gap-2">
                  {calendarsOf(account.id).map((calendar, index, list) => {
                    const busy = busySettingId === calendar.settingId;

                    return (
                      <li
                        key={calendar.settingId}
                        className="flex flex-col gap-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden
                            className="size-3 shrink-0 rounded-full ring-1 ring-foreground/15"
                            style={{ backgroundColor: calendar.backgroundColor ?? "transparent" }}
                          />
                          <span className="type-body-large min-w-0 flex-1 truncate font-medium">
                            {calendar.name}
                          </span>
                          {!calendar.canWrite && <Badge variant="outline">読み取り専用</Badge>}
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${calendar.name}を上へ移動`}
                              disabled={index === 0}
                              onClick={() => move(account.id, calendar.settingId, -1)}
                            >
                              <ChevronUp />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${calendar.name}を下へ移動`}
                              disabled={index === list.length - 1}
                              onClick={() => move(account.id, calendar.settingId, 1)}
                            >
                              <ChevronDown />
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <SettingChip
                            label="表示"
                            selected={calendar.visible}
                            disabled={busy}
                            onClick={() =>
                              updateSetting(calendar.settingId, { visible: !calendar.visible })
                            }
                          />
                          <SettingChip
                            label="使用"
                            selected={calendar.writeEnabled}
                            // Googleが読み取り専用で共有しているカレンダーは、そもそも書き込めない。
                            disabled={busy || !calendar.canWrite}
                            title={
                              calendar.canWrite
                                ? undefined
                                : "読み取り専用で共有されているため、書き込めません。"
                            }
                            onClick={() =>
                              updateSetting(calendar.settingId, {
                                writeEnabled: !calendar.writeEnabled,
                              })
                            }
                          />
                          {calendar.writeEnabled && calendar.canWrite && (
                            <SettingChip
                              label={calendar.isCreateDefault ? "既定の保存先" : "既定にする"}
                              tone="primary"
                              selected={calendar.isCreateDefault}
                              // 既定は1つだけ。外すのではなく、別のカレンダーを既定にして移す。
                              disabled={busy || calendar.isCreateDefault}
                              onClick={() =>
                                updateSetting(calendar.settingId, { isCreateDefault: true })
                              }
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => startTransition(() => router.refresh())}
              >
                <RefreshCw className="size-4" />
                再取得
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href="/api/google/connect">別のアカウントを追加</a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * 表示・使用・既定の選択チップ。
 *
 * スイッチではなくチップにしているのは、ラベルそのものが当たり判定になり、
 * つまみの左右どちらがオンかを読まずに済むため。高さは指で押し分けられる36pxにする。
 */
function SettingChip({
  label,
  selected,
  disabled,
  title,
  tone = "secondary",
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  title?: string;
  tone?: "secondary" | "primary";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "type-label-large flex h-9 min-w-0 items-center gap-1.5 rounded-lg px-3.5 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:pointer-events-none disabled:opacity-38",
        selected
          ? tone === "primary"
            ? "bg-primary-container text-on-primary-container"
            : "bg-secondary-container text-on-secondary-container"
          : "border border-outline text-on-surface-variant hover:bg-muted",
      )}
    >
      {selected && <Check className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{label}</span>
    </button>
  );
}

function ConnectResultMessage({ result }: { result: string }) {
  const messages: Record<string, { text: string; tone: "ok" | "error" }> = {
    connected: { text: "Google Calendarを接続しました。", tone: "ok" },
    cancelled: { text: "接続をキャンセルしました。", tone: "error" },
    state_mismatch: { text: "接続の検証に失敗しました。もう一度お試しください。", tone: "error" },
    exchange_failed: { text: "Googleとのトークン交換に失敗しました。", tone: "error" },
    no_refresh_token: {
      text: "更新用トークンを取得できませんでした。Googleアカウントの「サードパーティ製のアプリとサービス」からDaySpanのアクセス権を削除してから、もう一度接続してください。",
      tone: "error",
    },
    no_identity: { text: "Googleアカウントを特定できませんでした。", tone: "error" },
  };

  const message = messages[result];
  if (!message) return null;

  return (
    <p
      className={
        message.tone === "ok"
          ? "type-body-medium text-on-surface-variant"
          : "type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container"
      }
    >
      {message.text}
    </p>
  );
}
