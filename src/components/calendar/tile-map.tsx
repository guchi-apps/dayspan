"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LocateFixed, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { project, unproject, TILE_SIZE, type LatLng } from "@/lib/coordinates";

/**
 * OpenStreetMapのラスタタイルを敷いた地図（docs/spec.md §9）。
 *
 * 地図ライブラリを入れずに自前で描いている。ここで要るのは「中心の1点を選ぶ」ことだけで、
 * 経路・レイヤ・マーカー群といったライブラリの主機能を使わない。Service Workerを自前で
 * 書いているのと同じく、依存を増やさずに済む範囲に収める。
 *
 * **ピンは常に画面の中央で、動かすのは地図の側。** 押した位置にピンを落とす方式だと、
 * 押している指がその地点を隠すうえ、拡大縮小のたびにピンと地図がずれる。
 * 拡大縮小も常に中心を軸にするため、選んでいる地点は操作の間ずっと動かない。
 */

/** タイルの取得先。提供元を変えるときはここだけ直す。 */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** OpenStreetMapのタイルがある範囲。19より内側は用意されていない。 */
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;

/** ホイール1目盛りあたりのズーム量。1回転で1段ぶんくらいになる値。 */
const WHEEL_SENSITIVITY = 0.002;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function tileUrl(x: number, y: number, z: number): string {
  return TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

export function TileMap({
  center,
  zoom,
  onCenterChange,
  onZoomChange,
  onLocate,
  locating = false,
  className,
}: {
  center: LatLng;
  zoom: number;
  onCenterChange: (center: LatLng) => void;
  onZoomChange: (zoom: number) => void;
  /** 「現在地へ」を押したとき。位置情報の取得は呼び出し側が持つ。 */
  onLocate?: () => void;
  locating?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);

  // 押している指・ポインタの現在位置。2本になった時点でピンチとして扱う。
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  // 操作を始めた時点の状態。動かしている間の基準にする。
  const gestureRef = useRef<{
    pointer: { x: number; y: number };
    center: LatLng;
    zoom: number;
    distance: number | null;
  } | null>(null);

  // 最新の値をイベントハンドラから読む。ホイールは非パッシブで直接購読しており、
  // 中心が変わるたびにリスナーを張り直すと、動かしている最中のイベントを取りこぼす。
  const stateRef = useRef({ center, zoom });
  useEffect(() => {
    stateRef.current = { center, zoom };
  }, [center, zoom]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ホイールでの拡大縮小。ページのスクロールを止める必要があるため、
  // Reactのイベントではなく非パッシブのリスナーとして張る。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onZoomChange(clampZoom(stateRef.current.zoom - event.deltaY * WHEEL_SENSITIVITY));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [onZoomChange]);

  const distanceBetween = (pointers: Map<number, { x: number; y: number }>): number | null => {
    if (pointers.size < 2) return null;
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const beginGesture = useCallback(() => {
    const pointers = pointersRef.current;
    const points = [...pointers.values()];
    if (points.length === 0) {
      gestureRef.current = null;
      return;
    }

    // 2本のときは中点を基準にする。片方を離しても残りの指で続けられるようにするため。
    const pointer =
      points.length === 1
        ? points[0]
        : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };

    gestureRef.current = {
      pointer,
      center: stateRef.current.center,
      zoom: stateRef.current.zoom,
      distance: distanceBetween(pointers),
    };
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture();
    setDragging(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const gesture = gestureRef.current;
    if (!gesture) return;

    const points = [...pointers.values()];
    const pointer =
      points.length === 1
        ? points[0]
        : { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };

    // 指の間隔が変わったぶんだけ倍率を変える。軸は常に地図の中心。
    let nextZoom = gesture.zoom;
    const distance = distanceBetween(pointers);
    if (gesture.distance && distance) {
      nextZoom = clampZoom(gesture.zoom + Math.log2(distance / gesture.distance));
      onZoomChange(nextZoom);
    }

    // 掴んだ地点を指の下へ留める。倍率が変わっていれば、その倍率での移動量に直す。
    const scale = 2 ** (nextZoom - gesture.zoom);
    const origin = project(gesture.center, gesture.zoom);
    const next = unproject(
      {
        x: origin.x - (pointer.x - gesture.pointer.x) / scale,
        y: origin.y - (pointer.y - gesture.pointer.y) / scale,
      },
      gesture.zoom,
    );
    onCenterChange(next);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current = null;
      setDragging(false);
      return;
    }
    // 指が減っても操作は続く。残った指を基準に取り直す。
    beginGesture();
  };

  // タイルは整数のズームでしか用意されていない。中途半端な倍率は、いちばん近い
  // ズームのタイルを敷いてCSSで拡大縮小して見せる（ピンチの途中を滑らかにするため）。
  const baseZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom)));
  const scale = 2 ** (zoom - baseZoom);
  const tileCount = 2 ** baseZoom;

  const world = project(center, baseZoom);
  // 位置の基準は「地図の中心を枠の中心へ置く」。拡大縮小の軸（枠の中心）と揃えておくと、
  // CSSで倍率を変えても中心の地点はその場に留まる。
  const originX = world.x - size.width / 2;
  const originY = world.y - size.height / 2;

  // 敷く範囲は倍率で変わる。拡大して見せている間は、枠を覆うのに要るタイルが少なくて済む。
  const visibleWidth = size.width / scale;
  const visibleHeight = size.height / scale;
  const coverLeft = world.x - visibleWidth / 2;
  const coverTop = world.y - visibleHeight / 2;

  const tiles: { key: string; url: string; x: number; y: number }[] = [];
  if (size.width > 0 && size.height > 0) {
    const firstY = Math.floor(coverTop / TILE_SIZE);
    const lastY = Math.floor((coverTop + visibleHeight) / TILE_SIZE);
    const firstX = Math.floor(coverLeft / TILE_SIZE);
    const lastX = Math.floor((coverLeft + visibleWidth) / TILE_SIZE);

    for (let tileY = firstY; tileY <= lastY; tileY++) {
      // 南北はつながっていない。範囲の外は敷かない（下地の色が出る）。
      if (tileY < 0 || tileY >= tileCount) continue;
      for (let tileX = firstX; tileX <= lastX; tileX++) {
        // 東西はつながっている。日付変更線をまたいでも同じタイルを出す。
        const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: `${baseZoom}/${tileX}/${tileY}`,
          url: tileUrl(wrappedX, tileY, baseZoom),
          x: tileX * TILE_SIZE - originX,
          y: tileY * TILE_SIZE - originY,
        });
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-lg border border-outline-variant bg-surface-container-highest",
        // 指の操作をすべてこちらで受ける。既定のままだと、地図を動かしたつもりで
        // ダイアログが縦に流れる。
        "touch-none select-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="absolute inset-0"
        style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
      >
        {tiles.map((tile) => (
          // next/image は使わない。タイルはサーバーで最適化する対象ではなく、
          // 通すと1枚ごとに自分のサーバーへ往復が増える。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            width={TILE_SIZE}
            height={TILE_SIZE}
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{ left: tile.x, top: tile.y }}
          />
        ))}
      </div>

      {/* 中心のピン。地図と一緒には動かないため、タイルの層の外へ置く。 */}
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/35" />
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-full drop-shadow-[0_2px_3px_rgba(0,0,0,0.35)]"
        fill="var(--md-error)"
      >
        <path d="M12 2a7 7 0 0 0-7 7c0 5.2 6.2 12.2 6.5 12.5a.7.7 0 0 0 1 0C12.8 21.2 19 14.2 19 9a7 7 0 0 0-7-7Z" />
        <circle cx="12" cy="9" r="2.6" fill="#fff" />
      </svg>

      <div className="absolute top-2 right-2 flex flex-col gap-2">
        {onLocate && (
          <button
            type="button"
            aria-label="現在地へ"
            disabled={locating}
            className="grid size-10 place-items-center rounded-full border border-outline-variant bg-surface-container text-primary shadow-sm disabled:opacity-38"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onLocate}
          >
            <LocateFixed className={cn("size-5", locating && "animate-pulse")} />
          </button>
        )}
        <div className="flex flex-col overflow-hidden rounded-[20px] border border-outline-variant shadow-sm">
          <button
            type="button"
            aria-label="拡大"
            className="grid size-10 place-items-center bg-surface-container text-primary disabled:opacity-38"
            disabled={zoom >= MAX_ZOOM}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onZoomChange(clampZoom(Math.floor(zoom) + 1))}
          >
            <Plus className="size-5" />
          </button>
          <button
            type="button"
            aria-label="縮小"
            className="grid size-10 place-items-center border-t border-outline-variant bg-surface-container text-primary disabled:opacity-38"
            disabled={zoom <= MIN_ZOOM}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onZoomChange(clampZoom(Math.ceil(zoom) - 1))}
          >
            <Minus className="size-5" />
          </button>
        </div>
      </div>

      {/* 出典の表示。OpenStreetMapのデータを使う条件（ODbL）として必要。 */}
      <span className="absolute right-0 bottom-0 rounded-tl-md bg-white/80 px-1.5 text-[10px] leading-[14px] text-neutral-700">
        © OpenStreetMap contributors
      </span>
    </div>
  );
}

export { MIN_ZOOM, MAX_ZOOM };
