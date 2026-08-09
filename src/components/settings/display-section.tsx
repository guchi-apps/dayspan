"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WEEK_START_OPTIONS } from "@/lib/week-start";

export function DisplaySection({ weekStartsOn }: { weekStartsOn: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(weekStartsOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: number) => {
    // 応答を待ってから動かすと、選んだのに変わらない時間ができる。先に反映し、失敗したら戻す。
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/ui", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStartsOn: next }),
      });

      if (!response.ok) {
        setValue(previous);
        setError("設定を保存できませんでした。");
        return;
      }

      startTransition(() => router.refresh());
    } catch {
      setValue(previous);
      setError("設定を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="week-starts-on">週の開始日</Label>
            <p className="text-xs text-muted-foreground">
              月表示・週表示で、いちばん左に置く曜日です。
            </p>
          </div>

          <Select
            value={String(value)}
            onValueChange={(next) => change(Number(next))}
            disabled={busy || pending}
          >
            <SelectTrigger id="week-starts-on" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEK_START_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
