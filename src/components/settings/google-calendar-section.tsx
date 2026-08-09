"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectionStatusBadge } from "@/components/settings/connection-status-badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { CalendarSettingsResult, CalendarSummary } from "@/services/google-calendar/settings";

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

  const updateSetting = async (
    settingId: string,
    patch: { visible?: boolean; isCreateDefault?: boolean },
  ) => {
    setBusySettingId(settingId);
    try {
      const response = await fetch("/api/google/calendars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settingId, ...patch }),
      });
      if (response.ok) {
        startTransition(() => router.refresh());
      }
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

                <ul className="flex flex-col gap-2">
                  {result.calendars
                    .filter((calendar) => calendar.googleAccountId === account.id)
                    .map((calendar) => (
                      <li key={calendar.settingId} className="flex items-center gap-3">
                        <Switch
                          id={`visible-${calendar.settingId}`}
                          checked={calendar.visible}
                          disabled={busySettingId === calendar.settingId}
                          onCheckedChange={(checked) =>
                            updateSetting(calendar.settingId, { visible: checked })
                          }
                        />
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-full ring-1 ring-foreground/15"
                          style={{ backgroundColor: calendar.backgroundColor ?? "transparent" }}
                        />
                        <Label
                          htmlFor={`visible-${calendar.settingId}`}
                          className="flex-1 cursor-pointer font-normal"
                        >
                          {calendar.name}
                        </Label>

                        {calendar.isCreateDefault ? (
                          <Badge variant="secondary">既定の保存先</Badge>
                        ) : (
                          canCreateEvents(calendar) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busySettingId === calendar.settingId}
                              onClick={() =>
                                updateSetting(calendar.settingId, { isCreateDefault: true })
                              }
                            >
                              既定にする
                            </Button>
                          )
                        )}
                      </li>
                    ))}
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

// 読み取り専用で共有されたカレンダーには予定を作れないため、既定の保存先の候補から外す。
function canCreateEvents(calendar: CalendarSummary): boolean {
  return calendar.accessRole === "owner" || calendar.accessRole === "writer";
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
