"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, Trash2 } from "lucide-react";

import { TagChip } from "@/components/tags/tag-chip";
import { tagSwatchClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  TAG_COLORS,
  TAG_COLOR_LABELS,
  type TagColor,
  type TagKind,
  type TagOption,
} from "@/services/notion/tag-options";

export type TagSectionState = {
  kind: TagKind;
  title: string;
  description: string;
  /** 選択肢を持つプロパティが無い場合は null。何を用意すればよいかを案内する。 */
  options: TagOption[] | null;
  missingMessage: string;
  /** Notion側で色を直してもらうための入口。DBが未選択なら null。 */
  databaseUrl: string | null;
  /**
   * 勤務場所だけが持つ「出張扱い」の設定（docs/spec.md §34）。
   *
   * 選択肢そのものはNotionが一次情報源だが、どれを出張と見なすかはDaySpanが持つ
   * （NotionConnection.workTripPlaces）。出張のチェックを持たないDBでは決めても
   * 書き込む先が無いため、使えるかどうかも渡す。
   */
  trip?: { places: string[]; available: boolean };
};

/**
 * タグ・種類の一覧と、その追加・削除（docs/spec.md §9）。
 *
 * 名前と色を変えられるのは追加のときだけにしている。Notion APIが既存の選択肢の
 * 名前・色の変更を受け付けないため。作り直せば変えられるが、選択肢を消すと
 * それが付いていた既存ページからも外れてしまうので、DaySpanからはやらない。
 */
export function TagSection({ state }: { state: TagSectionState }) {
  const router = useRouter();

  const [options, setOptions] = useState(state.options);
  const [tripPlaces, setTripPlaces] = useState(state.trip?.places ?? []);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("default");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (request: Promise<Response>) => {
    setBusy(true);
    setError(null);
    try {
      const response = await request;
      const body = (await response.json().catch(() => null)) as {
        options?: TagOption[];
        message?: string;
      } | null;

      if (!response.ok) {
        setError(body?.message ?? "Notionへ反映できませんでした。");
        return false;
      }

      setOptions(body?.options ?? []);
      // 入力画面や一覧が持っている候補も古くなる。サーバー側の取得をやり直させる。
      router.refresh();
      return true;
    } catch {
      setError("Notionへ反映できませんでした。");
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * 出張扱いの切り替え。1件ずつではなく一覧をまるごと送る（同時に複数を切り替えたときに
   * 順番次第で結果が変わらないようにするため）。失敗したら押す前の状態へ戻す。
   */
  const toggleTrip = async (place: string, trip: boolean) => {
    const before = tripPlaces;
    const next = trip ? [...before, place] : before.filter((item) => item !== place);

    setTripPlaces(next);
    setError(null);

    try {
      const response = await fetch("/api/work/trip-places", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setTripPlaces(before);
        setError(body?.message ?? "出張扱いを保存できませんでした。");
        return;
      }
      // 勤務画面が持っている出張扱いの一覧も古くなる。サーバー側の取得をやり直させる。
      router.refresh();
    } catch {
      setTripPlaces(before);
      setError("出張扱いを保存できませんでした。");
    }
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    if (options?.some((option) => option.name === trimmed)) {
      setError(`「${trimmed}」はすでにあります。`);
      return;
    }

    const added = await send(
      fetch("/api/notion/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: state.kind, name: trimmed, color }),
      }),
    );

    if (added) setName("");
  };

  const remove = async (target: string) => {
    // Notionでは選択肢を消すと、それが付いていたページからも外れる。取り消せないため確認する。
    const confirmed = window.confirm(
      `「${target}」を削除します。\nこれが付いているNotionのページからも外れます。よろしいですか？`,
    );
    if (!confirmed) return;

    const removed = await send(
      fetch(
        `/api/notion/tags?kind=${state.kind}&name=${encodeURIComponent(target)}`,
        { method: "DELETE" },
      ),
    );

    // 消した名前はサーバー側でも出張扱いから落としているが、この画面が持っている一覧にも
    // 残る。残したまま別の場所を切り替えると、消したはずの名前を一緒に送り返してしまう。
    if (removed) setTripPlaces((places) => places.filter((place) => place !== target));
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-title-medium">{state.title}</h2>
          <p className="type-body-small text-on-surface-variant">{state.description}</p>
          {state.trip && options !== null && (
            <p className="type-body-small text-on-surface-variant">
              {state.trip.available
                ? "「出張扱いにする」を入れた場所を選ぶと、はじめから出張として登録されます（行き先はその場所の名前）。"
                : "勤務記録DBに出張（チェックボックス）のプロパティがないため、出張扱いは決められません。設定のNotion画面から追加できます。"}
            </p>
          )}
        </div>

        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        {options === null ? (
          <p className="type-body-medium text-on-surface-variant">{state.missingMessage}</p>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-rule">
              {options.map((option) => (
                <li key={option.id} className="flex flex-col gap-1 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <TagChip name={option.name} color={option.color} />
                    <span className="type-body-small text-on-surface-variant">
                      {TAG_COLOR_LABELS[option.color]}
                    </span>
                    <span className="flex-1" />
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      aria-label={`${option.name} を削除`}
                      disabled={busy}
                      onClick={() => remove(option.name)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  {/* 出張扱いは名前の下へ置く。同じ行に足すと、狭い画面で場所の名前が
                      押し出される（勤務場所の名前はそれ自体が何の記録かを示す）。 */}
                  {state.trip?.available && (
                    <label className="flex items-center gap-2 py-0.5">
                      <Switch
                        checked={tripPlaces.includes(option.name)}
                        onCheckedChange={(next) => toggleTrip(option.name, next)}
                      />
                      <span className="type-body-small text-on-surface-variant">出張扱いにする</span>
                    </label>
                  )}
                </li>
              ))}

              {options.length === 0 && (
                <li className="type-body-medium py-2 text-on-surface-variant">
                  まだ登録されていません。
                </li>
              )}
            </ul>

            <div className="flex flex-col gap-2 border-t border-rule pt-4">
              <Label htmlFor={`tag-name-${state.kind}`}>新しく追加</Label>

              <div className="flex min-w-0 items-center gap-2">
                <Input
                  id={`tag-name-${state.kind}`}
                  className="h-10 min-w-0 flex-1"
                  placeholder="名前"
                  value={name}
                  disabled={busy}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      add();
                    }
                  }}
                />
                <Button size="sm" disabled={busy || !name.trim()} onClick={add}>
                  <Plus className="size-4" />
                  追加
                </Button>
              </div>

              <ColorPicker value={color} onChange={setColor} disabled={busy} />

              <p className="type-body-small text-on-surface-variant">
                色を選べるのは追加のときだけです。すでにある{state.title}の色や名前は、
                Notionのプロパティ設定から変更してください。
              </p>

              {state.databaseUrl && (
                <a
                  href={state.databaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="type-body-small flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  Notionで開く
                </a>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 色見本から選ぶ。名前だけの一覧では、Notion上でどう見えるかが分からないため。 */
function ColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: TagColor;
  onChange: (color: TagColor) => void;
  disabled: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="色"
      className="flex min-w-0 flex-wrap items-center gap-1.5"
    >
      {TAG_COLORS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={TAG_COLOR_LABELS[option]}
          title={TAG_COLOR_LABELS[option]}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "size-8 rounded-full transition-[outline-color,outline-width]",
            "outline-2 outline-offset-2 focus-visible:outline-primary disabled:opacity-38",
            value === option ? "outline-on-surface" : "outline-transparent",
            tagSwatchClass(option),
          )}
        />
      ))}
    </div>
  );
}
