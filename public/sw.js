/*
 * DaySpan の Service Worker（docs/spec.md §21）。
 *
 * 役割は「オンラインのときに開いた画面を、オフラインでも開けるようにする」ことだけに絞る。
 * next.config.ts の experimental.useOffline は、ソフトナビゲーションと Server Actions を
 * オフライン中に保留して再接続後に送り直してくれるが、ページの再読み込み（コールドスタート）は
 * ブラウザがHTMLを取りにいくため、Service Worker が無いと必ず失敗する。そこを埋める。
 *
 * ただし「開いた画面」は、起動と再読み込みのときしかブラウザがHTMLを取りにいかない。
 * ナビからの移動はソフトナビゲーションで、そこでは何も保存されない。そのため画面側から
 * dayspan:warm を送ってもらい、開いている画面のHTMLをこちらで取って保存する（issue #321）。
 *
 * next-pwa / Serwist のようなビルド統合は使わず手書きしている。キャッシュしてよいものを
 * こちらで列挙できるほうが、認証付きのページや書き込みAPIを取り違えて保存する事故を防ぎやすい。
 *
 * オフライン中の編集を貯めて後から同期するキュー方式はMVP対象外（docs/spec.md §23）。
 * このファイルは書き込み（GET以外）にはいっさい介入しない。
 */

// キャッシュの世代。このファイルの保存方針を変えたときと、保存している応答の形が変わったときに
// 上げる。上げると activate で古い世代がまとめて消える。
//
// v3: タスクの紐づけが1件（link）から行き先ごとの配列（links）へ変わった（docs/spec.md §31）。
// 古い形の `/api/tasks` `/api/calendar` の応答を新しいJSへ渡すと、紐づけを読む場所で落ちる。
const VERSION = "v3";

const ASSET_CACHE = `dayspan-assets-${VERSION}`;
const PAGE_CACHE = `dayspan-pages-${VERSION}`;
const DATA_CACHE = `dayspan-data-${VERSION}`;
const CACHES = [ASSET_CACHE, PAGE_CACHE, DATA_CACHE];

// 保存する件数の上限。ページは表示形式×日付ぶん増えるため、際限なく貯めない。
const PAGE_LIMIT = 40;
const DATA_LIMIT = 40;

/**
 * ウォームアップ（dayspan:warm）で取り直さずに済ませる保存済みの新しさ。
 *
 * /calendar の描画はGoogle・Notionを叩く。画面を開くたびに温め直すと、外部APIへの往復が
 * 画面ぶんとウォームアップぶんで倍になる（docs/spec.md §20）。ハードナビゲーションで
 * 開いた直後は保存済みがこの範囲に入るため、何もせず終わる。
 */
const WARM_MAX_AGE_MS = 10 * 60 * 1000;

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
    return;
  }

  // 開いている画面から呼ぶ（issue #321）。その画面のHTMLを先に保存しておく。
  if (event.data?.type === "dayspan:warm") {
    event.waitUntil(warmPages(event.data.paths));
  }
});

/**
 * 通知の受け取り（docs/spec.md §32）。
 *
 * iOS 18.4以降のSafariは、`web_push: 8030` を持つJSONをここを通さずにそのまま表示する
 * （Declarative Web Push）。それより前のiOSと他のブラウザはこのイベントを受け取るため、
 * 同じJSONの `notification` を読んで同じ通知を出す。送信側は端末を見分けない。
 *
 * 受け取ったら必ず通知を出す。出さない（サイレントな）プッシュが続くと、iOSは購読そのものを
 * 取り消す。届いたのに何も出さない経路を作らないため、中身が読めなくても既定の文面で出す。
 */
self.addEventListener("push", (event) => {
  const fallback = { title: "DaySpan", body: "" };

  let notification = fallback;
  if (event.data) {
    try {
      const payload = event.data.json();
      notification = payload?.notification ?? fallback;
    } catch {
      notification = { title: "DaySpan", body: event.data.text() };
    }
  }

  event.waitUntil(
    (async () => {
      if (typeof notification.app_badge === "number" && "setAppBadge" in self.registration) {
        // 0 は「今日までのタスクが無い」。clearAppBadge と同じで、印が消える。
        await self.registration.setAppBadge(notification.app_badge).catch(() => {});
      }

      await self.registration.showNotification(notification.title || "DaySpan", {
        body: notification.body || "",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        lang: notification.lang || "ja",
        // 同じ印の通知は新しいものが古いものを置き換える（記録中の1件など）。
        tag: notification.tag || undefined,
        data: { url: notification.navigate || "/" },
      });
    })(),
  );
});

/**
 * 通知を押したとき。
 *
 * すでに開いている画面があればそれを使う。新しく開くと、PWAでは同じアプリの窓が
 * 増えたように見えるうえ、記録中かどうかを見ていた画面から離れることになる。
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(event.notification.data?.url || "/", self.location.origin);

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of clients) {
        if (new URL(client.url).origin !== target.origin) continue;
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href).catch(() => {});
          return;
        }
      }

      await self.clients.openWindow(target.href);
    })(),
  );
});

/**
 * 送信先がブラウザ側で作り直されたとき。
 *
 * 新しい送信先を伝えないと、以後の通知はどこにも届かない。利用者が設定画面を開き直すまで
 * 気付けないため、ここで登録し直す。
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) return;

      try {
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        await fetch("/api/notifications/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(subscription.toJSON()),
        });
      } catch {
        // 失敗しても画面からやり直せる。ここで出せる通知は無い。
      }
    })(),
  );
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
    event.respondWith(networkFirst(request, PAGE_CACHE, PAGE_LIMIT, true));
    return;
  }

  if (CACHED_DATA_PATHS.has(url.pathname)) {
    event.respondWith(networkFirst(request, DATA_CACHE, DATA_LIMIT, false));
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
async function networkFirst(request, cacheName, limit, allowOtherQuery) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);

    // 5xx は「届いたが今は応えられない」。proxy.ts はSupabase Authへ届かずログイン状態を
    // 確認できなかったときにこれを返す。保存済みがあるならそちらを出す。エラー画面を出すと、
    // 通信が不安定なだけの利用者に「ログアウトされた」と受け取られる。
    if (response.status >= 500) {
      const cached = await matchCached(cache, request, allowOtherQuery);
      if (cached) return cached;
      return response;
    }

    if (isCacheable(response)) {
      await cache.put(request, response.clone());
      await trim(cache, limit);
    }
    return response;
  } catch (cause) {
    const cached = await matchCached(cache, request, allowOtherQuery);
    if (cached) return cached;

    throw cause;
  }
}

/**
 * 保存済みの応答を探す。
 *
 * ページは、同じURLが無ければ同じ画面の別の日付を出す（allowOtherQuery）。表示形式・日付が
 * 違っていても、まったく何も出ないよりは手掛かりになる。
 *
 * APIには同じことをしない。/api/calendar?months=… の応答を別の月の要求へ返すと、
 * use-calendar-chunks.ts の splitByMonth() が要求した月に該当しない項目をすべて捨てるため、
 * その月が「取得できて、予定が1件も無かった」ように見える。取れなかったことにするほうが正しい。
 */
async function matchCached(cache, request, allowOtherQuery) {
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  if (!allowOtherQuery) return undefined;

  return cache.match(request, { ignoreVary: true, ignoreSearch: true });
}

/** 上限を超えたぶんを古い順に捨てる。Cache API は追加した順に keys() を返す。 */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;

  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

/**
 * 指定したページを取りにいって PAGE_CACHE へ入れる（issue #321）。
 *
 * ナビの移動はソフトナビゲーション（RSC）で、ここでは保存できない。そのままだと、
 * 起動と再読み込み以外で開いた画面はいつまでもキャッシュに入らず、オフラインで開けない。
 * ページ側から自分のパスを渡してもらい、ブラウザのナビゲーションと同じURLで保存しておく。
 *
 * ここで作る Request にRSCヘッダは付かないため、返るのはHTMLの文書そのもの。
 * Service Worker 自身の fetch は fetch イベントを再入しないので、素通りの心配もない。
 */
async function warmPages(paths) {
  if (!Array.isArray(paths)) return;

  const cache = await caches.open(PAGE_CACHE);

  for (const path of paths) {
    if (typeof path !== "string" || !path.startsWith("/")) continue;

    const url = new URL(path, self.location.origin);
    if (url.origin !== self.location.origin) continue;
    if (NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) continue;

    if (await isFresh(cache, url.href)) continue;

    try {
      // 認証はCookieで成立している。Service Worker 内の Request は既定でも同一オリジンへ
      // Cookie を送るが、ここは取り違えると未ログインの応答（/login へのリダイレクト）を
      // 取り続けることになるため明示する。
      const response = await fetch(new Request(url.href, { credentials: "same-origin" }));
      if (!isCacheable(response)) continue;

      await cache.put(url.href, response);
      await trim(cache, PAGE_LIMIT);
    } catch {
      // オフラインなら取れなくて当然。保存済みがあればそれが使われる。
    }
  }
}

/** 保存済みが WARM_MAX_AGE_MS 以内に取れたものか。取得時刻は応答の date ヘッダーで見る。 */
async function isFresh(cache, url) {
  const cached = await cache.match(url, { ignoreVary: true });
  if (!cached) return false;

  const date = Date.parse(cached.headers.get("date") ?? "");
  // date が無い応答は新しさを判断できない。取り直して確実なものに入れ替える。
  if (Number.isNaN(date)) return false;

  return Date.now() - date < WARM_MAX_AGE_MS;
}
