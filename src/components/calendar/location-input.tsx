"use client";

import { useState } from "react";

import { MapPin, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { PlaceSuggestion } from "@/lib/ai-place-suggest";
import type { PlaceItem } from "@/services/notion/places";

import { readErrorMessage } from "./response-error";

/** 一度に出す候補の数。多すぎると入力欄が候補で埋まって、打ち直しの邪魔になる。 */
const MAX_CANDIDATES = 6;

/**
 * 予定の「場所」欄（docs/spec.md §9）。
 *
 * 候補はNotionの場所DBを一次情報源とし、そこに無いものだけAIに尋ねる。
 * AIは呼ぶたびに枠を消費するため、候補が0件のときのボタン操作からだけ呼ぶ。
 * 候補は入力欄の下に押し出して出す。ダイアログの中で重ねると、
 * スクロール領域の端で隠れてどこまで候補があるのか分からなくなるため。
 */
export function LocationInput({
  value,
  onChange,
  places,
  eventTitle,
  placeDatabaseReady,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Notionの場所DBに登録済みの場所。 */
  places: PlaceItem[];
  /** AIが場所の見当をつける手がかりにする、入力中の予定のタイトル。 */
  eventTitle: string;
  /** 場所DBが設定済みか。未設定ならAIの提案を登録する先が無い。 */
  placeDatabaseReady: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [register, setRegister] = useState(true);

  const query = value.trim();
  const candidates = matchPlaces(places, query);
  // 候補が無いときだけAIに尋ねられる。登録済みの場所で足りるなら呼ぶ必要がない。
  const canAsk = open && query.length > 0 && candidates.length === 0;

  const change = (next: string) => {
    onChange(next);
    setOpen(true);
    setSuggestions(null);
    setError(null);
  };

  const choose = async (name: string, address: string | null, fromAi: boolean) => {
    onChange(toLocationText(name, address));
    setOpen(false);
    setSuggestions(null);

    if (!fromAi || !register || !placeDatabaseReady) return;

    // 登録に失敗しても入力した場所はそのまま残す。次に開いたときに候補として出ないだけ。
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, address }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "場所DBに登録できませんでした。"));
      }
    } catch {
      setError("場所DBに登録できませんでした。");
    }
  };

  const ask = async () => {
    setSuggesting(true);
    setError(null);
    try {
      const response = await fetch("/api/places/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, eventTitle }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "AIに聞けませんでした。"));
        return;
      }
      const body = (await response.json()) as { places: PlaceSuggestion[] };
      setSuggestions(body.places);
    } catch {
      setError("AIに聞けませんでした。");
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Input
        id="event-location"
        label="場所"
        value={value}
        onChange={(event) => change(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />

      {open && candidates.length > 0 && (
        <ul className="flex flex-col gap-1">
          {candidates.map((place) => (
            <li key={place.id}>
              <CandidateButton
                name={place.name}
                address={place.address}
                tags={place.tags}
                icon={<MapPin className="size-4 shrink-0 text-muted-foreground" />}
                onSelect={() => choose(place.name, place.address, false)}
              />
            </li>
          ))}
        </ul>
      )}

      {canAsk && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          {suggestions === null ? (
            <>
              <p className="text-xs text-muted-foreground">
                登録済みの場所に「{query}」はありません。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={suggesting}
                // 押した時点で入力欄からフォーカスが外れると、候補ごと閉じてしまう。
                onMouseDown={(event) => event.preventDefault()}
                onClick={ask}
              >
                <Sparkles className="size-4" />
                {suggesting ? "AIに聞いています…" : "AIに聞く"}
              </Button>
            </>
          ) : suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">AIからの候補はありませんでした。</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1">
                {suggestions.map((suggestion) => (
                  <li key={`${suggestion.name}:${suggestion.address ?? ""}`}>
                    <CandidateButton
                      name={suggestion.name}
                      address={suggestion.address}
                      tags={[]}
                      icon={<Sparkles className="size-4 shrink-0 text-muted-foreground" />}
                      onSelect={() => choose(suggestion.name, suggestion.address, true)}
                    />
                  </li>
                ))}
              </ul>
              {placeDatabaseReady && (
                <label className="flex min-h-11 items-center gap-3 text-sm select-none">
                  <Checkbox
                    checked={register}
                    onCheckedChange={(checked) => setRegister(checked === true)}
                    // 押した時点で入力欄からフォーカスが外れると、候補ごと閉じてしまう。
                    onMouseDown={(event) => event.preventDefault()}
                  />
                  選んだ場所を場所DBに登録する
                </label>
              )}
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function CandidateButton({
  name,
  address,
  tags,
  icon,
  onSelect,
}: {
  name: string;
  address: string | null;
  tags: string[];
  icon: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
      // 押した時点で入力欄からフォーカスが外れると、選ぶ前に候補が閉じてしまう。
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      {icon}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm">{name}</span>
        {(address || tags.length > 0) && (
          <span className="truncate text-xs text-muted-foreground">
            {[address, tags.join("・")].filter(Boolean).join(" / ")}
          </span>
        )}
      </span>
    </button>
  );
}

/** 場所欄へ入れる文字列。住所があれば添える。Google Calendar側で地図が引けるようにするため。 */
function toLocationText(name: string, address: string | null): string {
  return address ? `${name} ${address}` : name;
}

/**
 * 入力に合う場所を絞る。前方一致を先に、部分一致を後に置く。
 * 打ち始めの数文字で目当ての場所が上に来るようにするため。
 */
function matchPlaces(places: PlaceItem[], query: string): PlaceItem[] {
  if (!query) return places.slice(0, MAX_CANDIDATES);

  const needle = query.toLowerCase();
  const scored: { place: PlaceItem; score: number }[] = [];

  for (const place of places) {
    const name = place.name.toLowerCase();
    const address = place.address?.toLowerCase() ?? "";
    const tags = place.tags.join(" ").toLowerCase();

    const score = name.startsWith(needle)
      ? 0
      : address.startsWith(needle)
        ? 1
        : name.includes(needle)
          ? 2
          : address.includes(needle)
            ? 3
            : tags.includes(needle)
              ? 4
              : -1;

    if (score >= 0) scored.push({ place, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.place.name.localeCompare(b.place.name, "ja"))
    .slice(0, MAX_CANDIDATES)
    .map((item) => item.place);
}
