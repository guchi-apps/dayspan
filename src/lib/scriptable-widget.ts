/**
 * iPhoneウィジェット用のScriptable台本（docs/spec.md §28）。
 *
 * 台本は利用者の端末で動く。DaySpan側の画面ではないため、ここではReactやTailwindではなく
 * Scriptableが持つ描画APIだけで組む。エンドポイントとトークンは設定画面で埋め込んで配り、
 * 利用者に値を貼り込ませない。
 *
 * 台本は面（活動記録・今日の予定・タスク・買い物リスト）ごとに分けず1本にする。分けると
 * 貼り付けが面の数だけ増え、台本を直すたびに全部を貼り替えることになる。どの面を出すかは
 * ウィジェットを編集の `Parameter`（`args.widgetParameter`）で決める。同じ台本をホーム画面へ
 * 複数置き、枠ごとに値を変えれば4種類が同時に出せる。
 *
 * 中身をテンプレート文字列ではなく差し込み記号で持つのは、台本の側でJavaScriptの
 * テンプレートリテラル（`${...}`）を使えるようにするため。二重にエスケープすると、
 * 台本を読んだときにそのまま動く形に見えなくなる。
 *
 * ただし台本の中（SCRIPTABLE_TEMPLATE の内側）にはバッククォートを書けない。String.raw の
 * テンプレートがそこで閉じ、以降が丸ごとTypeScriptの構文として読まれる。コメントで識別子を
 * 囲みたくなる場所も含めて、引用符か素の名前で書く。
 */

const ENDPOINT_MARK = "__DAYSPAN_ENDPOINT_BASE__";
const TOKEN_MARK = "__DAYSPAN_TOKEN__";
const APP_URL_MARK = "__DAYSPAN_APP_URL__";
const WEBAPP_URL_MARK = "__DAYSPAN_WEBAPP_URL__";
const BRIDGE_URL_MARK = "__DAYSPAN_BRIDGE_URL__";
const REFRESH_MARK = "__DAYSPAN_REFRESH_MINUTES__";

/**
 * 台本が次の更新を要求する間隔（分）。iOSがこのとおりに更新するとは限らない目安値。
 *
 * 更新のたびに、その面の取得元（Google Calendar か Notion）へ1回問い合わせるため、
 * 短くするほど外部APIへの往復が増える（docs/spec.md §20「過剰なアクセスを発生させない」）。
 * 画面の案内文もこの値から作る。
 *
 * 同じ面をホーム画面とロック画面の両方へ置くと枠の数だけ更新が走るため、取得結果は
 * サーバー側で3分だけ持ち回す（services/widget/cache.ts・services/activity/today-cache.ts）。
 * 往復の数はウィジェットの数ではなくその保持時間で決まる。
 */
export const WIDGET_REFRESH_MINUTES = 5;

/**
 * ウィジェットに出せる面と、`Parameter` に入れる値。設定画面の案内もこの表から作る。
 *
 * 空欄は `activity`。配布済みの台本を置いたままの枠が、貼り替えなくても今までどおり
 * 活動記録を出し続けるようにするため。
 */
export const WIDGET_VIEW_CHOICES: { value: string; label: string; description: string }[] = [
  { value: "activity", label: "活動記録", description: "記録中の項目と今日の合計（空欄のときもこれ）" },
  { value: "schedule", label: "今日の予定", description: "これから始まる予定と移動" },
  { value: "tasks", label: "タスク", description: "期限切れ・今日・これからのタスク" },
  { value: "shopping", label: "買い物リスト", description: "まだ買っていないもの" },
];

export function buildScriptableWidgetScript(options: {
  /**
   * ウィジェットが読むAPIの絶対URL（面のパスを付ける前まで）。台本が
   * `ENDPOINT_BASE + "/" + 面` を組み立てる。
   */
  endpointBase: string;
  /** ウィジェット用トークン。未発行なら空文字を渡す（台本の見本として使う）。 */
  token: string;
  /** ウィジェットを押したときに開くDaySpanのURL。 */
  appUrl: string;
}): string {
  return SCRIPTABLE_TEMPLATE.replaceAll(ENDPOINT_MARK, escapeForJsString(options.endpointBase))
    .replaceAll(TOKEN_MARK, escapeForJsString(options.token))
    .replaceAll(APP_URL_MARK, escapeForJsString(options.appUrl))
    .replaceAll(WEBAPP_URL_MARK, escapeForJsString(toWebAppUrl(options.appUrl)))
    .replaceAll(BRIDGE_URL_MARK, escapeForJsString(toBridgeUrl(options.appUrl)))
    .replaceAll(REFRESH_MARK, String(WIDGET_REFRESH_MINUTES));
}

/**
 * ホーム画面に追加したDaySpan（Webアプリ）を開くURLへ直す。
 *
 * iOSは `https://` のリンクを必ずSafariで開き、ホーム画面のWebアプリへは渡さない。
 * Webアプリを直接開けるのは `webapp://` スキーム（iOS 16.4以降）だけ。SafariとWebアプリは
 * ストレージが別扱いのため、Safariへ落ちるとログインし直しになることがある。
 *
 * `http` のアドレス（LAN経由の開発サーバー等）では空文字を返す。httpのサイトはWebアプリとして
 * ホーム画面へ追加できず、`webapp://` の宛先になりようがないため。台本側はこのとき
 * ブラウザで開く側へ倒す。
 */
export function toWebAppUrl(origin: string): string {
  const scheme = "https://";
  return origin.startsWith(scheme) ? `webapp://${origin.slice(scheme.length)}` : "";
}

/**
 * ホーム画面のDaySpanへ渡すための受け渡しページ（`/open`）のURL。
 *
 * `http` のアドレスでは空文字を返す。渡す相手（ホーム画面のWebアプリ）がそもそも存在せず、
 * 受け渡しページを挟んでもブラウザで開くのと同じところへ着くため。`toWebAppUrl()` が
 * 空文字を返す条件とそろえてある。
 */
export function toBridgeUrl(origin: string): string {
  return toWebAppUrl(origin) ? `${origin}${WIDGET_OPEN_BRIDGE_PATH}` : "";
}

/**
 * ウィジェットを押したときに開くURL。設定画面の案内とコピー用に使う。
 *
 * 台本の中でも同じ組み立てをしている（`OPEN_URL`）。iOSのウィジェット編集画面
 * （長押し ▸ ウィジェットを編集）の `URL` 欄へ入れる値がこれで、そこは利用者が手で
 * 入力する欄のため、ホスト名を打ち間違えても気付ける場所が実機のウィジェット（何も出ない）
 * しかない。台本と同じく、値はこちらで作って渡す。
 *
 * 面ごとに変えられない。iOSは `webapp://` のパスを無視してWebアプリの最初の画面から開くため、
 * 買い物リストの枠を押しても着くのは記録の画面になる。
 *
 * - `bridge` … 既定。HTTPSの受け渡しページ（`/open`）を経由してホーム画面のDaySpanへ渡す。
 *   ウィジェットから `webapp://` を直接開けない端末があり、そこでは押しても何も起きない
 *   （issue #562）。`https://` のURLなら必ず開けるため、渡す先の判断をページ側へ移す。
 * - `app` … `webapp://` を直接開く従来の値。効いている端末ではこちらのほうが速い。
 * - `browser` … ブラウザで開く。
 *
 * `bridge` と `app` が null になるのは `http` のアドレス（LAN経由の開発サーバー等）で開いたとき。
 * httpのサイトはWebアプリとしてホーム画面へ追加できず、渡す相手がそもそも存在しない。
 */
export function buildWidgetOpenUrls(origin: string): {
  bridge: string | null;
  app: string | null;
  browser: string;
} {
  const webApp = toWebAppUrl(origin);

  return {
    bridge: toBridgeUrl(origin) || null,
    app: webApp ? `${webApp}${WIDGET_OPEN_PATH}` : null,
    browser: `${origin}${WIDGET_OPEN_PATH}`,
  };
}

/**
 * 受け渡しページのパス。`src/lib/widget-open-bridge.ts` の `WIDGET_OPEN_BRIDGE_PATH` と同じ値。
 *
 * importせず写しを置くのは、このファイルが他のモジュールを一切importしない前提で作られているため。
 * `scripts/preview-widget.mjs` はtscでこの1ファイルだけをJSへ落として読み込む（importを足すと、
 * ビルドは通るのにその道具だけが動かなくなる）。`/activity` を `DEFAULT_HOME_PATH` からではなく
 * `WIDGET_OPEN_PATH` として持っているのと同じ扱い。値を変えるときは両方直す。
 */
const WIDGET_OPEN_BRIDGE_PATH = "/open";

/**
 * 開く先のパス。記録の画面。
 *
 * `webapp://` ではiOSがパスを無視して最初の画面（`start_url`）から開くが、その最初の画面が
 * 記録のため同じ所へ着く（issue #299）。ブラウザで開くときはこのパスが効く。
 * 同じ組み立てで両方をまかなうため、どちらにも付ける。
 */
const WIDGET_OPEN_PATH = "/activity";

/**
 * JavaScriptの文字列リテラルの中身として安全な形にする。
 *
 * 差し込む値はどれも `"..."` の中へ入る。originは Host ヘッダーから組み立てているため、
 * 引用符や改行が混ざると台本の文字列リテラルを抜けて、その先が構文の壊れた台本になる。
 * JSON.stringify はダブルクォートで囲んだ結果を返すので、その外側だけを外して使う。
 */
function escapeForJsString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

const SCRIPTABLE_TEMPLATE = String.raw`// DaySpan ウィジェット
//
// 設定 > iPhoneウィジェット から生成された台本です。
// トークンが入っているので、そのまま他人へ渡さないでください。
//
// 使い方: Scriptableで新しいスクリプトを作り、この内容を貼り付けて保存します。
// ホーム画面を長押し > ウィジェットを追加 > Scriptable > このスクリプトを選びます。
//
// 何を出すかは、置いたウィジェットを長押し > ウィジェットを編集 の Parameter で決まります。
//   （空） / activity … 活動記録
//   schedule          … 今日の予定
//   tasks             … タスク
//   shopping          … 買い物リスト
// 同じ台本を複数置いて、枠ごとに違う値を入れられます。
//
// ウィジェットを押したときと、Scriptableの一覧でこの台本のアイコンを押したときは、
// どちらもDaySpanが開きます（ウィジェットの見本は表示しません）。
//
// 押してもScriptableが開くだけで先へ進まないときは、ウィジェットを長押し > ウィジェットを編集 の
// When Interacting を Open URL にし、URL 欄へ設定画面に出ているURLを入れてください。

const ENDPOINT_BASE = "__DAYSPAN_ENDPOINT_BASE__";
const TOKEN = "__DAYSPAN_TOKEN__";
const APP_URL = "__DAYSPAN_APP_URL__";

// ホーム画面に追加したDaySpan（Webアプリ）を開くためのURL。iOS 16.4以降のスキームです。
// httpのアドレスで作った台本では空になります（httpのサイトはWebアプリとして追加できないため）。
const WEBAPP_URL = "__DAYSPAN_WEBAPP_URL__";

// ホーム画面のDaySpanへ渡すためのHTTPSのページ。
// 端末によっては webapp:// を直接開けず、押してもScriptableが開くだけで先へ進みません。
// httpsのURLなら必ず開けるので、いったんこのページへ飛ばし、そこから切り替えます。
// httpのアドレスで作った台本では空になります（渡す相手がいないため）。
const BRIDGE_URL = "__DAYSPAN_BRIDGE_URL__";

// 押したときに開く先。
//   "app"        … ホーム画面に追加したDaySpan（上のページを経由します）
//   "app-direct" … ホーム画面に追加したDaySpan（webapp:// を直接開きます。効く端末はこちらが速い）
//   "browser"    … ブラウザ（ホーム画面に追加していないときはこちらにしてください）
const OPEN_IN = "app";

// 次の更新までの目安（分）。iOSは要求どおりに更新するとは限りません。
const REFRESH_MINUTES = __DAYSPAN_REFRESH_MINUTES__;

// Parameter に入れられる値。
const VIEWS = ["activity", "schedule", "tasks", "shopping"];

// DaySpanの画面と同じ配色。記録中だけ色を変え、色でも記録中かどうかが分かるようにする。
const RUN_BG = Color.dynamic(new Color("#eaddff"), new Color("#4f378b"));
const RUN_INK = Color.dynamic(new Color("#21005d"), new Color("#eaddff"));
const IDLE_BG = Color.dynamic(new Color("#fef7ff"), new Color("#1d1b20"));
const IDLE_INK = Color.dynamic(new Color("#1d1b20"), new Color("#e6e0e9"));
// 目盛りの下地。文字色から作れないため、明暗のどちらでも沈まない灰色を薄く敷く。
const TRACK = new Color("#8a8a8a", 0.3);
// 優先度の帯。タスク画面・買い物リストと同じ色（error / tertiary）に揃える。
const PRIORITY_HIGH = Color.dynamic(new Color("#b3261e"), new Color("#f2b8b5"));
const PRIORITY_MID = Color.dynamic(new Color("#7d5260"), new Color("#efb8c8"));

const FAMILY = config.widgetFamily || "small";
const IS_ACCESSORY = FAMILY.indexOf("accessory") === 0;

// 押したときに開く先。ウィジェットの中では記録を start / stop できないため、
// 「止めたい」と思った操作がそのまま画面へつながるようにする。
//
// 既定（"app"）はHTTPSの受け渡しページです。端末によっては webapp:// を直接開けず、押しても
// Scriptableが開くだけで先へ進まないため、ページ側でホーム画面のDaySpanへ切り替えます。
//
// "app-direct" は webapp:// を直接開きます。iOSはこのスキームのパスを無視し、Webアプリの
// 最初の画面から開きます。その最初の画面が記録の画面なので、どの経路でも同じ所へ着きます
// （すでに開いていたときは前の画面のまま）。それでも /activity を付けているのは、
// ブラウザで開くときにはこのパスが効くためです。
const OPEN_URL = resolveOpenUrl();

function resolveOpenUrl() {
  if (OPEN_IN === "app" && BRIDGE_URL) return BRIDGE_URL;
  if (OPEN_IN === "app-direct" && WEBAPP_URL) return WEBAPP_URL + "/activity";
  return APP_URL + "/activity";
}

// 出す面。空欄は活動記録（貼り替えていない枠を今までどおり動かすため）。
// 知らない値は活動記録へ落とさずに断る。落とすと、打ち間違いに気付ける場所が無くなる。
const VIEW = readView();

if (config.runsInWidget) {
  const data = VIEW
    ? await load(VIEW)
    : { error: "Parameterには " + VIEWS.join(" / ") + " のいずれかを入れてください。" };
  const widget = build(data);

  widget.url = OPEN_URL;
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);

  Script.setWidget(widget);
} else {
  // Scriptableの一覧からこの台本のアイコンを押したときは、ウィジェットの見本を出さずにDaySpanを開く。
  // 押す理由は「いまの記録を見たい・止めたい」で、見本を挟むと目的の画面まで1手増える。
  // 記録の取得もしない。開くだけなら要らない往復のため（docs/spec.md §20）。
  Safari.open(OPEN_URL);
}
Script.complete();

function readView() {
  const raw = (args.widgetParameter || "").trim().toLowerCase();
  if (raw === "") return "activity";
  return VIEWS.indexOf(raw) >= 0 ? raw : null;
}

async function load(view) {
  try {
    const request = new Request(ENDPOINT_BASE + "/" + view);
    // トークンはクエリではなくヘッダーで送る。URLに載せるとサーバーのアクセスログに残る。
    request.headers = { Authorization: "Bearer " + TOKEN };
    request.timeoutInterval = 15;

    const json = await request.loadJSON();
    const status = request.response.statusCode;

    if (status !== 200) {
      return { error: (json && json.message) || "取得できませんでした（" + status + "）" };
    }
    return { summary: json };
  } catch (error) {
    return { error: "DaySpanへつながりませんでした。" };
  }
}

function build(data) {
  const widget = new ListWidget();
  const summary = data.summary;
  // 背景で記録中を示すのは活動記録の面だけ。他の面は記録の有無を読んでいない。
  const running = VIEW === "activity" && summary ? summary.running : null;

  if (IS_ACCESSORY) {
    // ロック画面のウィジェットはiOSが白の濃淡で描き直す。色では記録中かどうかを示せない。
    widget.addAccessoryWidgetBackground = true;
    widget.setPadding(2, 4, 2, 4);
  } else {
    widget.backgroundColor = running ? RUN_BG : IDLE_BG;
    widget.setPadding(14, 15, 14, 15);
  }

  const ink = IS_ACCESSORY ? Color.white() : running ? RUN_INK : IDLE_INK;

  if (data.error) {
    renderError(widget, ink, data.error);
  } else if (VIEW === "activity") {
    renderActivity(widget, ink, summary);
  } else {
    renderList(widget, ink, modelOf(VIEW, summary));
  }

  return widget;
}

// --- 活動記録 ---

function renderActivity(widget, ink, summary) {
  if (FAMILY === "accessoryCircular") {
    renderCircular(widget, ink, summary);
  } else if (FAMILY === "accessoryInline") {
    renderInline(widget, ink, summary);
  } else if (IS_ACCESSORY) {
    renderRectangular(widget, ink, summary);
  } else if (FAMILY === "medium" || FAMILY === "large") {
    renderMedium(widget, ink, summary);
  } else {
    renderSmall(widget, ink, summary);
  }
}

// ホーム画面（小）。「いま何を、どれだけ続けているか」の1つだけ。経過時間をいちばん大きい字にする。

function renderSmall(widget, ink, summary) {
  const running = summary.running;

  addHeader(widget, ink, running ? "記録中" : "DaySpan", running !== null);
  widget.addSpacer(6);

  const title = addText(widget, ink, running ? running.title : "記録していません", Font.semiboldSystemFont(15));
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.7;

  if (running) {
    widget.addSpacer(2);
    addTimer(widget, ink, running.startedAt, Font.boldSystemFont(32));
  }

  widget.addSpacer();

  const lines = metaLines(summary).slice(0, 2);
  for (let i = 0; i < lines.length; i++) {
    const meta = addText(widget, ink, lines[i], Font.systemFont(11));
    meta.textOpacity = 0.75;
    meta.lineLimit = 1;
    meta.minimumScaleFactor = 0.7;
  }
}

// ホーム画面（中）。左に記録中の1件、右に今日の内訳。

function renderMedium(widget, ink, summary) {
  const running = summary.running;

  const row = widget.addStack();
  row.layoutHorizontally();
  row.spacing = 12;

  const left = row.addStack();
  left.layoutVertically();
  left.size = new Size(124, 0);

  addHeader(left, ink, running ? "記録中" : "DaySpan", running !== null);
  left.addSpacer(6);

  const title = addText(left, ink, running ? running.title : "記録していません", Font.semiboldSystemFont(15));
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.7;

  if (running) {
    left.addSpacer(2);
    addTimer(left, ink, running.startedAt, Font.boldSystemFont(30));
    left.addSpacer();
    const from = addText(left, ink, formatTime(running.startedAt, summary.timeZone) + " から", Font.systemFont(11));
    from.textOpacity = 0.75;
    from.lineLimit = 1;
  } else {
    left.addSpacer();
  }

  const divider = row.addStack();
  divider.size = new Size(1, 110);
  divider.backgroundColor = TRACK;

  const right = row.addStack();
  right.layoutVertically();

  if (!summary.today) {
    const note = addText(right, ink, unavailableText(summary.todayUnavailable), Font.systemFont(12));
    note.textOpacity = 0.75;
    right.addSpacer();
    return;
  }

  const head = right.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const headLabel = addText(head, ink, "今日", Font.semiboldSystemFont(11));
  headLabel.textOpacity = 0.75;
  head.addSpacer();
  addText(head, ink, formatDuration(summary.today.totalMinutes), Font.boldSystemFont(15));

  right.addSpacer(8);

  const items = summary.today.items;
  const longest = items.length > 0 ? items[0].minutes : 0;

  if (items.length === 0) {
    const empty = addText(right, ink, "まだ記録がありません", Font.systemFont(11));
    empty.textOpacity = 0.75;
  }

  for (let i = 0; i < items.length; i++) {
    if (i > 0) right.addSpacer(6);
    addBar(right, ink, items[i], longest);
  }

  right.addSpacer();

  const at = addText(right, ink, formatTime(summary.now, summary.timeZone) + " 時点", Font.systemFont(10));
  at.textOpacity = 0.6;
}

function addBar(stack, ink, item, longest) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 5;

  const nameBox = row.addStack();
  nameBox.size = new Size(38, 0);
  const name = addText(nameBox, ink, item.title, Font.systemFont(11));
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.7;
  name.textOpacity = 0.85;

  const trackWidth = 54;
  const track = row.addStack();
  track.size = new Size(trackWidth, 6);
  track.cornerRadius = 3;
  track.backgroundColor = TRACK;

  const ratio = longest > 0 ? item.minutes / longest : 0;
  const fill = track.addStack();
  // 短い記録でも棒が消えないよう、下限を持たせる。
  fill.size = new Size(Math.max(4, Math.round(trackWidth * ratio)), 6);
  fill.cornerRadius = 3;
  fill.backgroundColor = ink;
  track.addSpacer();

  row.addSpacer();

  const time = addText(row, ink, formatDuration(item.minutes), Font.systemFont(11));
  time.textOpacity = 0.85;
  time.lineLimit = 1;
}

// ロック画面（活動記録）。色が使えないため、形と文字だけで読める並びにする。

function renderRectangular(widget, ink, summary) {
  const running = summary.running;

  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 5;

  if (running) addDot(row, ink, 7);

  const title = addText(row, ink, running ? running.title : "記録していません", Font.semiboldSystemFont(12));
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.7;

  if (running) {
    addTimer(widget, ink, running.startedAt, Font.boldSystemFont(20));
  }

  const lines = metaLines(summary).slice(0, 1);
  if (lines.length > 0) {
    const meta = addText(widget, ink, lines[0], Font.systemFont(11));
    meta.textOpacity = 0.75;
    meta.lineLimit = 1;
    meta.minimumScaleFactor = 0.7;
  }
}

function renderCircular(widget, ink, summary) {
  const running = summary.running;

  widget.addSpacer();
  if (running) {
    const timer = addTimer(widget, ink, running.startedAt, Font.boldSystemFont(15));
    timer.centerAlignText();
  } else {
    const value = addText(widget, ink, "—", Font.boldSystemFont(15));
    value.centerAlignText();
    value.lineLimit = 1;
  }

  const label = addText(widget, ink, running ? running.title : "停止中", Font.systemFont(9));
  label.centerAlignText();
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.6;
  widget.addSpacer();
}

function renderInline(widget, ink, summary) {
  const running = summary.running;

  // インラインの枠（時計の上の1行）は要素を1つしか置けない。項目名と経過時間の両方は入らないため、
  // 進み続ける経過時間のほうを採る。項目名は円形・横長の枠に出ている。
  if (running) {
    addTimer(widget, ink, running.startedAt, Font.systemFont(12));
    return;
  }

  addText(widget, ink, "記録していません", Font.systemFont(12));
}

// --- 一覧の面（今日の予定・タスク・買い物リスト） ---
//
// 3つとも「見出し＋数行＋脚注」で読む形は同じ。枠ごとの描き分けをここに1つだけ持ち、
// 面ごとに違うのは中身を組み立てる modelOf() だけにする。面の数だけ描画を書くと、
// 行数や余白の直しを面の数ぶん繰り返すことになる。

function modelOf(view, summary) {
  if (view === "schedule") return scheduleModel(summary);
  if (view === "tasks") return tasksModel(summary);
  return shoppingModel(summary);
}

function scheduleModel(summary) {
  const items = summary.items || [];
  const upcoming = items.filter(function (item) {
    return !item.past;
  });
  const done = items.length - upcoming.length;

  // 1行の枠に出すのは、これから始まるもののうち時刻の決まっている先頭。終日を先に出すと、
  // 研修ウィークのような1日中続く項目がある日は、次に何時に何があるかが出なくなる。
  const timed = upcoming.filter(function (item) {
    return !item.allDay;
  });
  const next = timed.length > 0 ? timed[0] : upcoming.length > 0 ? upcoming[0] : null;

  return {
    label: "今日の予定",
    head: "残り" + upcoming.length,
    headWide: formatDateKey(summary.date) + " ・ 残り" + upcoming.length,
    circle: { value: String(upcoming.length), label: "予定" },
    inline: next ? whenOf(next, summary.timeZone) + " " + next.title : "今日の予定なし",
    rows: items.map(function (item) {
      return {
        when: whenOf(item, summary.timeZone),
        text: item.title,
        // 中止・不参加は理由より先に「起こらなかった」ことが読めればよい（docs/spec.md §37）。
        side: item.outcome ? outcomeLabel(item.outcome) : item.detail,
        mode: item.mode,
        priority: null,
        dim: item.past || item.outcome !== null,
      };
    }),
    // 見出しの数字が数えているもの。行は残りが先に並ぶため、入りきらなかった数もここから出す。
    total: upcoming.length,
    bars: false,
    foot: done > 0 ? ["済み " + done + "件"] : [],
    footSmall: [],
    stamp: formatTime(summary.now, summary.timeZone) + " 時点",
    note: scheduleNote(summary.unavailable),
    empty: "今日の予定はありません",
  };
}

function tasksModel(summary) {
  const items = summary.items || [];
  const due = summary.overdueCount + summary.todayCount;

  return {
    label: "タスク",
    head: String(due),
    headWide: "期限切れ " + summary.overdueCount + " ・ 今日 " + summary.todayCount,
    circle: { value: String(due), label: "タスク" },
    inline:
      due > 0
        ? "期限切れ" + summary.overdueCount + "・今日" + summary.todayCount
        : "期限の来たタスクなし",
    rows: items.map(function (item) {
      return {
        when: null,
        text: item.title,
        side: item.dueLabel,
        mode: null,
        priority: item.priority,
        dim: false,
      };
    }),
    total: summary.total,
    bars: true,
    foot: [],
    // 小さい枠は行の右端に期限を出す幅が無く、見出しにも数字しか入らない。内訳を脚注へ回さないと、
    // 「4」が期限切れなのか今日ぶんなのかがどこにも出ない。
    footSmall: ["期限切れ " + summary.overdueCount + "・今日 " + summary.todayCount],
    stamp: formatTime(summary.now, summary.timeZone) + " 時点",
    note: tasksNote(summary.unavailable),
    empty: "期限のあるタスクはありません",
  };
}

function shoppingModel(summary) {
  const items = summary.items || [];

  return {
    label: "買い物リスト",
    head: String(summary.remaining),
    headWide: "残り " + summary.remaining,
    circle: { value: String(summary.remaining), label: "買い物" },
    inline: summary.remaining > 0 ? "買い物 残り" + summary.remaining : "買うものなし",
    rows: items.map(function (item) {
      return {
        when: null,
        text: item.name,
        side: item.category,
        mode: null,
        priority: item.priority,
        dim: false,
      };
    }),
    total: summary.remaining,
    bars: true,
    foot: [],
    footSmall: [],
    stamp: formatTime(summary.now, summary.timeZone) + " 時点",
    note: shoppingNote(summary.unavailable),
    empty: "買うものはありません",
  };
}

function renderList(widget, ink, model) {
  if (FAMILY === "accessoryCircular") return renderListCircular(widget, ink, model);
  if (FAMILY === "accessoryInline") return renderListInline(widget, ink, model);
  if (IS_ACCESSORY) return renderListRectangular(widget, ink, model);

  const max = FAMILY === "large" ? 8 : FAMILY === "medium" ? 4 : 3;
  const rows = model.note ? [] : model.rows.slice(0, max);
  const wide = FAMILY !== "small";

  // 連携が未設定・取得できなかったときに件数を出すと、0件だったのか読めなかったのかが
  // 区別できない。数字の代わりに横棒を置く（丸い枠と同じ扱い）。
  addHeader(widget, ink, model.label, false, model.note ? "—" : wide ? model.headWide : model.head);

  if (model.note) {
    widget.addSpacer(6);
    const note = addText(widget, ink, model.note, Font.systemFont(11));
    note.textOpacity = 0.75;
    note.lineLimit = 3;
    note.minimumScaleFactor = 0.7;
  } else if (rows.length === 0) {
    widget.addSpacer(6);
    const empty = addText(widget, ink, model.empty, Font.systemFont(11));
    empty.textOpacity = 0.75;
    empty.lineLimit = 2;
  } else {
    widget.addSpacer(6);
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) widget.addSpacer(5);
      addRow(widget, ink, rows[i], { showSide: wide, showBar: model.bars });
    }
  }

  widget.addSpacer();

  // 脚注は下から詰める。小さい枠は2行までで、いつ時点かはホーム画面の大きい枠にだけ出す
  // （小さい枠でその1行を使うと、項目が1件ぶん落ちる）。
  const foot = footLines(model, rows, wide);
  for (let i = 0; i < foot.length; i++) {
    const line = addText(widget, ink, foot[i], Font.systemFont(i === foot.length - 1 && wide ? 10 : 11));
    line.textOpacity = i === foot.length - 1 && wide ? 0.6 : 0.75;
    line.lineLimit = 1;
    line.minimumScaleFactor = 0.7;
  }
}

/**
 * 脚注。下から詰める。
 *
 * foot はどの枠にも出す行、footSmall は小さい枠だけに出す行（広い枠では見出しや行の右端に
 * 同じことが出ているため）。いつ時点かはホーム画面の大きい枠にだけ出す。小さい枠でその1行を
 * 使うと、項目が1件ぶん落ちる。
 */
function footLines(model, shown, wide) {
  const lines = model.note ? [] : (wide ? model.foot : model.footSmall.concat(model.foot)).slice();

  // 数えるのは見出しの数字に入っている行だけ。予定の面は済んだぶんを別の行で示しており、
  // そこまで足すと同じものが2つの数に出る。
  const counted = shown.filter(function (row) {
    return !row.dim;
  }).length;
  const hidden = model.total - counted;
  if (!model.note && hidden > 0) lines.push("ほか " + hidden + "件");

  if (wide) {
    lines.push(model.stamp);
    return lines;
  }
  return lines.slice(0, 2);
}

function renderListRectangular(widget, ink, model) {
  const head = addText(
    widget,
    ink,
    model.label + "  " + (model.note ? "—" : model.headWide),
    Font.semiboldSystemFont(12),
  );
  head.lineLimit = 1;
  head.minimumScaleFactor = 0.7;

  if (model.note) {
    const note = addText(widget, ink, model.note, Font.systemFont(11));
    note.textOpacity = 0.75;
    note.lineLimit = 2;
    note.minimumScaleFactor = 0.7;
    return;
  }

  const rows = model.rows.slice(0, 2);
  if (rows.length === 0) {
    const empty = addText(widget, ink, model.empty, Font.systemFont(11));
    empty.textOpacity = 0.75;
    empty.lineLimit = 1;
    empty.minimumScaleFactor = 0.7;
    return;
  }

  for (let i = 0; i < rows.length; i++) {
    // ロック画面は色が白の濃淡へ潰される。優先度の帯は色でしか意味を持たないため置かない。
    addRow(widget, ink, rows[i], { showSide: false, showBar: false });
  }
}

function renderListCircular(widget, ink, model) {
  widget.addSpacer();

  const value = addText(widget, ink, model.note ? "—" : model.circle.value, Font.boldSystemFont(18));
  value.centerAlignText();
  value.lineLimit = 1;
  value.minimumScaleFactor = 0.6;

  const label = addText(widget, ink, model.circle.label, Font.systemFont(9));
  label.centerAlignText();
  label.lineLimit = 1;
  label.minimumScaleFactor = 0.6;

  widget.addSpacer();
}

function renderListInline(widget, ink, model) {
  // インラインの枠は要素を1つしか置けない。件数より、次に何が来るかのほうが読む理由に近い。
  addText(widget, ink, model.note ? model.label + " —" : model.inline, Font.systemFont(12));
}

/**
 * 一覧の1行。左から 優先度の帯 / 時刻 / 交通手段の印 / 項目名 …… 右端に補足。
 *
 * 項目名だけは必ず出す。狭い枠で削るなら補足のほう（狭い列で印より名前を先に残すのと同じ扱い）。
 */
function addRow(container, ink, row, options) {
  const line = container.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  line.spacing = 4;

  if (options.showBar) addPriorityBar(line, row.priority);

  if (row.when) {
    // 時刻の幅を揃える。揃えないと、終日と時刻の行で項目名の始まる位置がずれる。
    const box = line.addStack();
    box.size = new Size(33, 0);
    const when = addText(box, ink, row.when, Font.mediumSystemFont(11));
    when.lineLimit = 1;
    when.minimumScaleFactor = 0.7;
    if (row.dim) when.textOpacity = 0.5;
  }

  if (row.mode) addModeMark(line, ink, row.mode, row.dim);

  const text = addText(line, ink, row.text, Font.systemFont(11));
  text.lineLimit = 1;
  text.minimumScaleFactor = 0.7;
  if (row.dim) text.textOpacity = 0.5;

  line.addSpacer();

  if (options.showSide && row.side) {
    const side = addText(line, ink, row.side, Font.systemFont(10));
    side.textOpacity = row.dim ? 0.45 : 0.6;
    side.lineLimit = 1;
  }
}

/**
 * 優先度の帯。タスク画面・買い物リストと同じ「行左端の色帯」に揃える。
 *
 * 低・未設定でも同じ幅の場所を空ける。空けないと、優先度の付いた行だけ項目名が右へずれ、
 * 縦に読んだときに文字の始まりが揃わない。
 */
function addPriorityBar(container, priority) {
  const bar = container.addStack();
  bar.size = new Size(3, 12);

  if (priority === "高") {
    bar.cornerRadius = 1.5;
    bar.backgroundColor = PRIORITY_HIGH;
  } else if (priority === "中") {
    bar.cornerRadius = 1.5;
    bar.backgroundColor = PRIORITY_MID;
  }
}

/**
 * 交通手段の印（docs/spec.md §29）。車・電車・足跡は輪郭を読んだ時点で移動だと分かる。
 *
 * 右矢印は使わない。方向・遷移・「次へ」など何にでも当たる記号で、移動そのものを指していない
 * （issue #548）。記号の名前はiOSの版で増えるため、使える名前を順に試して最初に見つかった
 * ものを使い、どれも無ければ印そのものを落とす（印が無くても行き先の名前は読める）。
 */
function addModeMark(container, ink, mode, dim) {
  const names =
    mode === "CAR"
      ? ["car.fill"]
      : mode === "PUBLIC_TRANSIT"
        ? ["tram.fill", "train.side.front.car"]
        : mode === "WALK"
          ? ["figure.walk"]
          : ["signpost.right.fill", "map.fill"];

  for (let i = 0; i < names.length; i++) {
    const symbol = SFSymbol.named(names[i]);
    if (!symbol) continue;

    const image = container.addImage(symbol.image);
    image.imageSize = new Size(11, 11);
    image.tintColor = ink;
    if (dim) image.imageOpacity = 0.5;
    return;
  }
}

// --- 共通 ---

function renderError(widget, ink, message) {
  // ロック画面は入る行数がホーム画面より少ない。見出しまで出すと肝心の理由が押し出される。
  if (IS_ACCESSORY) {
    if (FAMILY === "accessoryCircular") {
      widget.addSpacer();
      const mark = addText(widget, ink, "—", Font.boldSystemFont(15));
      mark.centerAlignText();
      widget.addSpacer();
      return;
    }

    const detail = addText(widget, ink, message, Font.systemFont(12));
    detail.lineLimit = FAMILY === "accessoryInline" ? 1 : 2;
    detail.minimumScaleFactor = 0.7;
    return;
  }

  addHeader(widget, ink, "DaySpan", false);
  widget.addSpacer(6);

  const title = addText(widget, ink, "表示できません", Font.semiboldSystemFont(14));
  title.lineLimit = 1;

  widget.addSpacer(4);

  const detail = addText(widget, ink, message, Font.systemFont(11));
  detail.textOpacity = 0.75;
  detail.lineLimit = 3;
  detail.minimumScaleFactor = 0.7;

  widget.addSpacer();
}

function addHeader(container, ink, label, running, trailing) {
  const row = container.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 5;

  if (running) addDot(row, ink, 8);

  const text = addText(row, ink, label, Font.semiboldSystemFont(11));
  text.textOpacity = 0.75;
  text.lineLimit = 1;
  row.addSpacer();

  if (trailing) {
    const value = addText(row, ink, trailing, Font.semiboldSystemFont(11));
    value.lineLimit = 1;
    value.minimumScaleFactor = 0.7;
  }
}

// 動いていることを色だけでなく形でも示す。ロック画面では色が使えないため。
function addDot(container, ink, size) {
  const dot = container.addStack();
  dot.size = new Size(size, size);
  dot.cornerRadius = size / 2;
  dot.backgroundColor = ink;
}

function addText(container, ink, value, font) {
  const text = container.addText(value);
  text.font = font;
  text.textColor = ink;
  return text;
}

/**
 * 経過時間。数字は開始時刻だけ渡してiOSに数えさせる（WidgetDate のタイマー表示）。
 *
 * サーバーが求めた分数を文字として置くと、次に台本が動くまでその値で止まる。iOSはウィジェットを
 * 要求どおりの間隔では更新しないため、開いて見るたびに古い時間が出ることになる。タイマー表示なら
 * 台本を動かさずにiOSが描き直し続ける（31:05 / 1時間を超えると 1:02:03）。
 *
 * 桁が増えると枠に収まらなくなるため、縮小を許す。
 */
function addTimer(container, ink, startedAt, font) {
  const timer = container.addDate(new Date(startedAt));
  timer.applyTimerStyle();
  timer.font = font;
  timer.textColor = ink;
  timer.lineLimit = 1;
  timer.minimumScaleFactor = 0.6;
  return timer;
}

/** 枠の下に添える補足。記録中は開始時刻、停止中は最後に何を記録したか。 */
function metaLines(summary) {
  const lines = [];
  const running = summary.running;
  const today = summary.today;

  if (running) {
    lines.push(formatTime(running.startedAt, summary.timeZone) + " から");
  }

  if (today) {
    lines.push("今日 " + formatDuration(today.totalMinutes));
    if (!running && today.last) {
      lines.push("最後は " + today.last.title + " " + formatTime(today.last.endedAt, summary.timeZone) + " まで");
    }
  } else {
    lines.push(unavailableText(summary.todayUnavailable));
  }

  return lines;
}

function unavailableText(reason) {
  if (reason === "google_unavailable") return "今日の記録を取得できませんでした";
  return "設定で記録の保存先カレンダーを選ぶと、今日の合計も出ます";
}

function scheduleNote(reason) {
  if (reason === "google_unavailable") return "今日の予定を取得できませんでした";
  if (reason === "google_not_connected") return "設定でGoogleカレンダーを接続すると、今日の予定が出ます";
  return null;
}

function tasksNote(reason) {
  if (reason === "notion_unavailable") return "タスクを取得できませんでした";
  if (reason === "notion_not_connected") return "設定でNotionのタスクDBを選ぶと、タスクが出ます";
  return null;
}

function shoppingNote(reason) {
  if (reason === "notion_unavailable") return "買い物リストを取得できませんでした";
  if (reason === "shopping_not_ready") return "設定でNotionの買い物リストDBを選ぶと、残りが出ます";
  return null;
}

function outcomeLabel(kind) {
  return kind === "ABSENT" ? "不参加" : "中止";
}

function whenOf(item, timeZone) {
  return item.allDay || !item.start ? "終日" : formatTime(item.start, timeZone);
}

function formatDuration(minutes) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours + ":" + (rest < 10 ? "0" + rest : "" + rest);
}

/**
 * 設定タイムゾーンでの時刻。端末のタイムゾーンではなくDaySpanの設定に合わせる。
 * 端末側で時差のある場所にいても、アプリの画面と同じ時刻が出る必要がある。
 */
function formatTime(iso, timeZone) {
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", {
      timeZone: timeZone,
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch (error) {
    const formatter = new DateFormatter();
    formatter.dateFormat = "H:mm";
    return formatter.string(new Date(iso));
  }
}

/**
 * YYYY-MM-DD を「9月6日(土)」に直す。
 *
 * 曜日は日付の数字だけから求める（時刻を持たないため、端末のタイムゾーンに左右されない）。
 */
function formatDateKey(dateKey) {
  const parts = String(dateKey || "").split("-");
  if (parts.length !== 3) return "";

  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return Number(parts[1]) + "月" + Number(parts[2]) + "日(" + days[date.getDay()] + ")";
}
`;
