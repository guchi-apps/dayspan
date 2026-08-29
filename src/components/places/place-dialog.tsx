"use client";

import { useState } from "react";
import { useOffline } from "next/offline";
import { MapPin, X } from "lucide-react";

import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { PlaceMapDialog } from "@/components/calendar/place-map-dialog";
import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatCoordinates, type LatLng } from "@/lib/coordinates";
import type { PlaceItem } from "@/services/notion/places";

/** 場所DBの構成によって、住所・座標の置き場所そのものが無いことがある。 */
export type PlaceCapabilities = { address: boolean; coordinates: boolean };

/**
 * 登録済みの場所の編集（docs/spec.md §9）。
 *
 * 予定・タスク・日付リマインドの入力（`ItemDialog`）へは混ぜない。あちらは日時の欄が主で、
 * 場所は日付も時刻も持たないため、同じダイアログに入れると欄がまるごと入れ替わる
 * （買い物の項目を専用ダイアログにしたのと同じ理由）。
 */
export function PlaceDialog({
  place,
  capabilities,
  onClose,
  onSaved,
}: {
  place: PlaceItem;
  capabilities: PlaceCapabilities;
  onClose: () => void;
  /** 保存・削除できたとき。一覧を取り直すのは呼び出し側の役目。 */
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [name, setName] = useState(place.name);
  const [address, setAddress] = useState(place.address ?? "");
  const [coordinates, setCoordinates] = useState<LatLng | null>(place.coordinates);
  const [mapOpen, setMapOpen] = useState(false);
  /**
   * 地点の欄に触ったか。
   *
   * 座標の欄にDaySpanが読めない文字（`梅田駅の北側` など）が入っていると、画面には
   * 「地点なし」と出る。触っていないのに「消す」として送ると、開いて保存しただけで
   * その文字が消える。触っていなくて元も空なら、そもそも送らない。
   */
  const [coordinatesTouched, setCoordinatesTouched] = useState(false);

  const offline = useOffline();

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const finish = () => {
    setOpen(false);
    setTimeout(onSaved, 150);
  };

  const send = async (init: RequestInit, fallback: string) => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/places/${place.id}`, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return;
      }
      finish();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("名前を入力してください。");
      return;
    }

    await send(
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          ...(capabilities.address ? { address: address.trim() || null } : {}),
          ...(capabilities.coordinates && (coordinatesTouched || place.coordinates)
            ? { coordinates: coordinates ? formatCoordinates(coordinates) : null }
            : {}),
        }),
      },
      "保存できませんでした。",
    );
  };

  const remove = async () => {
    await send({ method: "DELETE" }, "削除できませんでした。");
  };

  return (
    <>
      {/*
        地図は登録せず、選んだ地点と住所だけを返してもらう。ここで住所も一緒に置き換えるのは、
        座標があるとき地図・Yahoo!乗換案内は座標のほうを先に見るため。住所だけ直して座標が
        前のまま残ると、画面に出ている文字列と実際に開く地点が食い違う。
      */}
      {mapOpen && (
        <PlaceMapDialog
          query={name}
          places={[]}
          onCancel={() => setMapOpen(false)}
          onRegistered={() => setMapOpen(false)}
          onPicked={(picked) => {
            setCoordinates(picked.coordinates);
            setCoordinatesTouched(true);
            if (capabilities.address) setAddress(picked.address);
            setMapOpen(false);
          }}
        />
      )}

      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
          <DialogTitle>場所を編集</DialogTitle>
          <DialogDescription className="sr-only">
            名前・住所・地点を変更するか、この場所を削除します。
          </DialogDescription>

          {error && (
            <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
              {error}
            </p>
          )}

          {/* 文字を打つ欄には ✕ を出す（issue #446）。打ち直す前にまとめて消せるようにするため。 */}
          <Input
            label="名前"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onClear={() => setName("")}
          />

          {capabilities.address && (
            <Input
              label="住所"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              onClear={() => setAddress("")}
            />
          )}

          {capabilities.coordinates && (
            <div className="flex flex-col gap-2">
              <span className="type-label-large text-on-surface-variant">地点</span>
              <div className="flex items-center gap-2">
                <span className="type-body-small min-w-0 flex-1 truncate font-mono text-on-surface-variant">
                  {coordinates ? formatCoordinates(coordinates) : "地点なし"}
                </span>
                {coordinates && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setCoordinates(null);
                      setCoordinatesTouched(true);
                    }}
                  >
                    <X className="size-4" />
                    外す
                  </Button>
                )}
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setMapOpen(true)}>
                  <MapPin className="size-4" />
                  地図
                </Button>
              </div>
              <p className="type-body-small text-on-surface-variant">
                地点があると、この場所を開くときに地図とYahoo!乗換案内がその座標を使います。
              </p>
            </div>
          )}

          {/* 削除は必ず確認を挟む（docs/spec.md §7）。押し間違えても画面上に戻す手立てが無い。
              Notionのゴミ箱からは戻せるため、その旨も出す。 */}
          {confirming ? (
            <div className="flex flex-col gap-3 pt-2">
              <p className="type-body-medium">
                「{place.name}」を削除しますか？Notionのゴミ箱からは元に戻せます。
              </p>
              <p className="type-body-small text-on-surface-variant">
                すでに予定・移動に入っている「{place.name}」の文字は消えません。次から入力の候補に出なくなります。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  やめる
                </Button>
                <Button variant="destructive" className="flex-1" disabled={busy} onClick={remove}>
                  削除する
                </Button>
              </div>
            </div>
          ) : (
            <ItemFormActions
              saveDisabled={busy || offline || !name.trim()}
              onSave={save}
              onDelete={() => setConfirming(true)}
              deleteDisabled={busy || offline}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
