/**
 * アプリを開いたときに最初に出す画面のフォールバック（issue #299・#637）。
 *
 * 記録は「いま何かを始める・終える」その瞬間の操作で、探してから押すのでは間に合わない
 * （docs/spec.md §4・§27）。メインナビの先頭に置いているのと同じ理由で、起動画面の既定も
 * ここにする。
 *
 * 起動画面そのものは設定 ▸ 表示から選べる（`START_PATH_COOKIE`・issue #637）。この定数は
 * 端末ごとの記憶（Cookie）が無い・不正な値のときのフォールバックとして残す。
 */
export const DEFAULT_HOME_PATH = "/activity";

/**
 * 起動画面として選べるパス（issue #637）。下部ナビ5画面と同じ
 * （`NAV_ITEMS`・`src/components/nav/nav-items.ts`）。
 *
 * それ以外の画面（日付リマインド・場所・設定など）は「起動時にまず見たい画面」という
 * 用途に合わないものが多く、選択肢を増やすと選ぶ手間が増える。
 *
 * 値を `NAV_ITEMS` から作らずここへ複製するのは、`NAV_ITEMS` の import が `lucide-react` の
 * アイコンまで連れてくるため。このファイルはミドルウェア（`src/proxy.ts` 経由の全リクエスト）
 * と `home-path.test.mts`（純粋関数のテスト）の両方から読まれ、どちらにもアイコンは不要
 * （CLAUDE.md「自動テスト」節・計画レビュー指摘）。下部ナビの並び・項目が変わったら両方直す。
 */
const START_PATHS = [
  { path: "/calendar", label: "カレンダー" },
  { path: "/tasks", label: "タスク" },
  { path: "/activity", label: "記録" },
  { path: "/work", label: "勤務" },
  { path: "/shopping", label: "買い物" },
] as const;

export const START_PATH_OPTIONS = START_PATHS.map((item) => item.path);

/**
 * 起動画面の記憶（端末ごと・issue #637）を持つCookie名。
 *
 * localStorageではなくCookieにするのは、`/`（起動時のリダイレクト元）・`/auth/callback`・
 * `/login`・ミドルウェアがいずれもサーバー側でリダイレクト先を決めており、クライアントで
 * 読むには描き終えてからもう一往復かかるため（`CALENDAR_VIEW_COOKIE` と同じ理由）。
 */
export const START_PATH_COOKIE = "dayspan_start_path";

/**
 * 起動画面の記憶の有効期間（400日・主要ブラウザのCookie上限）。
 *
 * カレンダーの表示形式・日付の記憶（3分）と違い、こちらは「選んだらしばらく効き続ける
 * 設定」のため長期間にする。切れたら選び直すまで既定（`DEFAULT_HOME_PATH`）へ戻る。
 */
export const START_PATH_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

/** Cookieの値が起動画面として選べるパスかどうか。 */
export function isStartPath(value: string | null | undefined): boolean {
  return !!value && (START_PATH_OPTIONS as readonly string[]).includes(value);
}

/** 起動画面のパスから、設定画面に出すラベルを引く。保存済みの値が選択肢から外れていても既定へ寄せる。 */
export function startPathLabel(path: string | null | undefined): string {
  return START_PATHS.find((item) => item.path === path)?.label ?? "記録";
}

/**
 * ログイン後の戻り先（`next` / `callbackUrl`）を、外部へ飛ばされない形に整える。
 *
 * `/` で始まっても2文字目が `/` か `\` なら弾くのは、WHATWG URLの解析では特殊スキームの
 * ホストで `\` が `/` と等価に扱われるため。`//example.com` はプロトコル相対URL、
 * `/\evil.com` も `new URL()` に渡すと `https://evil.com/` になり、どちらも外部サイトを指す
 * （guchi-apps/dayspan#596）。
 * 判定を1か所に置くのは、`/`・`/auth/signin`・`/auth/callback`・`/login`・ミドルウェアの
 * 5経路で同じ既定値を使う必要があり、`start_url` とずれるとiPhoneウィジェットの着地点の
 * 前提（docs/spec.md §28）まで崩れるため。
 *
 * `param` が無い・安全でないときは、`startPathCookieValue`（起動画面の記憶）が使えればそちら、
 * 無ければ `DEFAULT_HOME_PATH` に落ちる。
 */
export function resolveInternalPath(
  param: string | null | undefined,
  startPathCookieValue?: string | null,
): string {
  if (param && param.startsWith("/") && !/^\/[/\\]/.test(param)) return param;
  if (isStartPath(startPathCookieValue)) return startPathCookieValue as string;
  return DEFAULT_HOME_PATH;
}

/**
 * 起動画面をこの端末に覚えさせる（クライアント専用・issue #637）。
 *
 * 他サイトからの遷移では送られなくてよいため lax。https のときだけ secure を付ける
 * （開発サーバーは http で、付けるとブラウザがCookieごと捨てる）。`calendar-view-memory.ts`
 * の `rememberCalendarView` と同じ属性。
 */
export function rememberStartPath(path: string): void {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; secure" : "";

  document.cookie =
    `${START_PATH_COOKIE}=${path}` +
    `; path=/; max-age=${START_PATH_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}

/** 起動画面の記憶を捨てる（既定の `DEFAULT_HOME_PATH` へ戻す）。 */
export function forgetStartPath(): void {
  if (typeof document === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; secure" : "";

  document.cookie = `${START_PATH_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}
