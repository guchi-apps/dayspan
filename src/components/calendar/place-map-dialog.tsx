"use client";

import { useOffline } from "next/offline";
import { useEffect, useRef, useState } from "react";

import { MapPin, Plus } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatCoordinates,
  isSamePoint,
  parseCoordinates,
  type LatLng,
} from "@/lib/coordinates";
import type { PlaceItem } from "@/services/notion/places";

import { readErrorMessage } from "./response-error";
import { TileMap } from "./tile-map";

/**
 * 地図から場所を登録する（docs/spec.md §9）。
 *
 * 予定・移動の「場所」欄から開き、現在地または地図を動かして地点を選び、名前を付けて
 * Notionの場所DBへ1件足す。入力ダイアログの上に重ねて開き、閉じ切ってから呼び出し元へ返す
 * （開いたままアンマウントすると<body>のpointer-events:noneが残ることがあるため）。
 */

/** 建物が見分けられる程度の倍率。地点を選ぶ操作はこのあたりから始める。 */
const DEFAULT_ZOOM = 17;

/** 現在地も手掛かりも無いときの中心。 */
const FALLBACK_CENTER: LatLng = { lat: 35.681236, lng: 139.767125 };

/** 前回選んだ地点。次に開くときの中心に使う。 */
const LAST_CENTER_KEY = "dayspan:place-map-center";

/** 地図が止まってから住所を調べるまでの待ち。動かしている間はNominatimを呼ばない。 */
const LOOKUP_DELAY_MS = 700;

type AddressState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; address: string }
  | { status: "none" };

function readLastCenter(): LatLng | null {
  try {
    return parseCoordinates(window.localStorage.getItem(LAST_CENTER_KEY));
  } catch {
    // プライベートブラウズなどで読めないことがある。無ければ既定の中心から始める。
    return null;
  }
}

function writeLastCenter(center: LatLng) {
  try {
    window.localStorage.setItem(LAST_CENTER_KEY, formatCoordinates(center));
  } catch {
    // 保存できなくても、この操作自体は成立する。
  }
}

export function PlaceMapDialog({
  query,
  places,
  onCancel,
  onRegistered,
}: {
  /** 場所欄に入力されている文字列。名前の初期値と、開いたときの中心を決める手掛かりにする。 */
  query: string;
  /** 登録済みの場所。同じ名前のものに座標があれば、そこを中心にして開く。 */
  places: PlaceItem[];
  onCancel: () => void;
  /** 登録できたとき。場所欄へ入れるのは呼び出し側の役目。 */
  onRegistered: (place: PlaceItem) => void;
}) {
  const [open, setOpen] = useState(true);
  // 開いたときの中心。登録済みの場所に座標があればそこから始める。
  // 残りの手掛かり（入力中の地名・現在地）は取得に往復が要るため、下のeffectで置き換える。
  const [center, setCenter] = useState<LatLng>(() => {
    const typed = query.trim();
    const known = typed
      ? places.find((place) => place.name === typed && place.coordinates)
      : undefined;
    return known?.coordinates ?? readLastCenter() ?? FALLBACK_CENTER;
  });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [name, setName] = useState(query.trim());
  // 打った文字列は利用者が決めた名前。地図から取れた施設名で上書きしない。
  const [nameTouched, setNameTouched] = useState(query.trim().length > 0);
  const [address, setAddress] = useState<AddressState>({ status: "idle" });
  const [locating, setLocating] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 住所を調べ終えた地点。同じ場所で何度も問い合わせないようにする。
  const lookedUpRef = useRef<LatLng | null>(null);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const moveTo = (next: LatLng, nextZoom = DEFAULT_ZOOM) => {
    setCenter(next);
    setZoom(nextZoom);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setNotice("この端末では現在地を取得できません。地図を動かして地点を選んでください。");
      return;
    }

    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        moveTo({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
      },
      () => {
        // 拒否・失敗のどちらでも地図は使える。文言だけ出して操作は止めない。
        setNotice("現在地を取得できませんでした。地図を動かして地点を選んでください。");
        setLocating(false);
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };

  // 座標を持つ場所が当たらなかったときの中心。入力中の地名があればその地点、無ければ現在地。
  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      const typed = query.trim();
      const known = typed
        ? places.find((place) => place.name === typed && place.coordinates)
        : undefined;
      // 登録済みの座標はすでに初期値に入っている。
      if (known?.coordinates) return;

      if (!typed) {
        locate();
        return;
      }

      try {
        const response = await fetch(`/api/places/geocode?q=${encodeURIComponent(typed)}`);
        if (!response.ok) return;
        const body = (await response.json()) as { place: { lat: number; lng: number } | null };
        if (cancelled || !body.place) return;
        moveTo({ lat: body.place.lat, lng: body.place.lng });
      } catch {
        // 見つからなければ前回の中心のまま。地図を動かして選べる状態にはなっている。
      }
    };

    void resolve();

    return () => {
      cancelled = true;
    };
    // 開いた時点の入力だけを見る。以降は地図の操作で中心が決まる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 地図が止まってから住所を調べる。動かしている間に呼ぶと、往復が動かしたぶんだけ積み上がる。
  useEffect(() => {
    if (lookedUpRef.current && isSamePoint(lookedUpRef.current, center)) return;

    const timer = setTimeout(async () => {
      lookedUpRef.current = center;
      setAddress({ status: "loading" });
      try {
        const response = await fetch(
          `/api/places/geocode?lat=${center.lat}&lon=${center.lng}`,
        );
        if (!response.ok) {
          setAddress({ status: "none" });
          return;
        }
        const body = (await response.json()) as {
          place: { name: string | null; address: string | null } | null;
        };
        setAddress(
          body.place?.address ? { status: "found", address: body.place.address } : { status: "none" },
        );
        // 名前をまだ触っていないときだけ、地図から取れた施設名を初期値に入れる。
        const found = body.place?.name;
        if (found && !nameTouched) setName(found);
      } catch {
        setAddress({ status: "none" });
      }
    }, LOOKUP_DELAY_MS);

    return () => clearTimeout(timer);
  }, [center, nameTouched]);

  const register = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    const trimmed = name.trim();
    if (!trimmed) {
      setError("名前を入力してください。");
      return;
    }

    setRegistering(true);
    setError(null);
    try {
      const response = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          // 住所が取れなかったときは緯度経度を住所として入れる。数字のままでも地図は引ける。
          address: address.status === "found" ? address.address : formatCoordinates(center),
          coordinates: formatCoordinates(center),
        }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "場所DBに登録できませんでした。"));
        return;
      }

      const place = (await response.json()) as PlaceItem;
      writeLastCenter(center);
      setOpen(false);
      setTimeout(() => onRegistered(place), 150);
    } catch {
      setError("場所DBに登録できませんでした。");
    } finally {
      setRegistering(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>地図から場所を登録</DialogTitle>
          <DialogDescription>中央のピンの位置が登録する地点になります。</DialogDescription>
        </DialogHeader>

        <TileMap
          center={center}
          zoom={zoom}
          onCenterChange={setCenter}
          onZoomChange={setZoom}
          onLocate={locate}
          locating={locating}
          className="h-[40vh] max-h-80 min-h-56"
        />

        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2 text-on-surface-variant">
            {address.status === "loading" ? (
              <>
                <span
                  aria-hidden="true"
                  className="mt-1 size-3.5 shrink-0 animate-spin rounded-full border-2 border-outline-variant border-t-on-surface-variant"
                />
                <span className="type-body-small">住所を調べています…</span>
              </>
            ) : (
              <>
                <MapPin className="mt-0.5 size-4 shrink-0" />
                <span className="type-body-small">
                  {address.status === "found"
                    ? address.address
                    : address.status === "none"
                      ? "住所は分かりませんでした。緯度経度で登録します。"
                      : "地図を動かすと住所を調べます。"}
                </span>
              </>
            )}
          </div>
          <span className="type-body-small pl-6 font-mono text-on-surface-variant opacity-85">
            {formatCoordinates(center)}
          </span>
        </div>

        <Input
          id="place-map-name"
          label="名前"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameTouched(true);
          }}
        />
        <p className="type-body-small text-on-surface-variant">
          この名前で場所DBへ登録し、場所欄に「名前 住所」の形で入ります。
        </p>

        {notice && <p className="type-body-small text-on-surface-variant">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" disabled={registering} onClick={close}>
            キャンセル
          </Button>
          <Button disabled={registering || offline || !name.trim()} onClick={register}>
            <Plus className="size-4" />
            {registering ? "登録しています…" : "登録して使う"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
