/*
 * DaySpan の Service Worker（docs/spec.md §21）。
 *
 * 役割は「オンラインのときに開いた画面を、オフラインでも開けるようにする」ことだけに絞る。
 * next.config.ts の experimental.useOffline は、ソフトナビゲーションと Server Actions を
 * オフライン中に保留して再接続後に送り直してくれるが、ページの再読み込み（コールドスタート）は
 * ブラウザがHTMLを取りにいくため、Service Worker が無いと必ず失敗する。そこを埋める。
 *
 * next-pwa / Serwist のようなビルド統合は使わず手書きしている。キャッシュしてよいものを
 * こちらで列挙できるほうが、認証付きのページや書き込みAPIを取り違えて保存する事故を防ぎやすい。
 *
 * オフライン中の編集を貯めて後から同期するキュー方式はMVP対象外（docs/spec.md §23）。
 * このファイルは書き込み（GET以外）にはいっさい介入しない。
 */

// キャッシュの世代。このファイルの保存方針を変えたときに上げる。
// 上げると activate で古い世代がまとめて消える。
const VERSION = "v1";

const ASSET_CACHE = `dayspan-assets-${VERSION}`;
const PAGE_CACHE = `dayspan-pages-${VERSION}`;
const DATA_CACHE = `dayspan-data-${VERSION}`;
const CACHES = [ASSET_CACHE, PAGE_CACHE, DATA_CACHE];

// 保存する件数の上限。ページは表示形式×日付ぶん増えるため、際限なく貯めない。
const PAGE_LIMIT = 40;
const DATA_LIMIT = 40;

/**
 * 内容が変わってもURLが変わらないもの。取得できたら差し替える（stale-while-revalidate）。
 * /_next/static/ はファイル名にハッシュが入るため、こちらではなくキャッシュ優先で扱う。
 */
const REVALIDATED_ASSETS = new Set([
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-icon",
]);

/**
 * いっさいキャッシュしないパス。
 *
 * 認証はCookieとリダイレクトで成立しているため、途中の応答を保存すると
 * ログイン状態を取り違える。外部サービスの接続操作も同じ理由で対象外にする。
 */
const NEVER_CACHE_PREFIXES = ["/auth/", "/login", "/api/google/", "/api/notion/", "/api/settings/"];

/** オフラインでも読めるようにするGET API。応答はJSONで、認証は毎回サーバーが確認する。 */
const CACHED_DATA_PATHS = new Set(["/api/calendar", "/api/tasks"]);

self.addEventListener("install", () => {
  // 事前に貯めるものは無い。新しい版を待たせる理由もないため、すぐ有効化へ進む。
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("dayspan-") && !CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  // ログアウト時に呼ぶ。別のアカウントで開いたときに前のユーザーの画面が出ないようにする。
  if (event.data?.type === "dayspan:clear-cache") {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        await Promise.all(
          names.filter((name) => name.startsWith("dayspan-")).map((name) => caches.delete(name)),
        );
      })(),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // 書き込みには介入しない。オフラインでの送信はアプリ側が止める（docs/spec.md §21）。
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (REVALIDATED_ASSETS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }

  // ブラウザ自身のページ読み込み。ここを賄えると、オフラインでも起動・再読み込みができる。
  //
  // RSCヘッダが付く要求（ルーターのソフトナビゲーションと先読み）は対象外にする。
  // 応答の中身が Next-Router-State-Tree や先読みかどうかで変わり、
  // 別の状況で再生すると描画が壊れるため、保存したものを使い回せない。
  if (request.mode === "navigate" && !request.headers.has("RSC")) {
    event.respondWith(networkFirst(request, PAGE_CACHE, PAGE_LIMIT));
    return;
  }

  if (CACHED_DATA_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(request, DATA_CACHE, DATA_LIMIT));
  }
});

/** 保存してよい応答か。リダイレクトの結果と部分応答は、そのまま返すと状態を取り違える。 */
function isCacheable(response) {
  return Boolean(response) && response.status === 200 && response.type === "basic" && !response.redirected;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });

  const update = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const response = await update;
  if (response) return response;
  throw new Error("offline");
}

/**
 * オンラインなら常に最新を返し、取れなかったときだけ保存済みを返す。
 *
 * ページとAPIはどちらもユーザーの最新の状態を映すものなので、キャッシュ優先にはしない。
 * 「オフラインだから前の内容が出ている」以外の理由で古い内容が出ることは避ける。
 */
async function networkFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
      await trim(cache, limit);
    }
    return response;
  } catch (cause) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;

    // 同じ画面の別の日付しか無い場合は、それを出す。まったく何も出ないよりは手掛かりになる。
    const fallback = await cache.match(request, { ignoreVary: true, ignoreSearch: true });
    if (fallback) return fallback;

    throw cause;
  }
}

/** 上限を超えたぶんを古い順に捨てる。Cache API は追加した順に keys() を返す。 */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;

  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
