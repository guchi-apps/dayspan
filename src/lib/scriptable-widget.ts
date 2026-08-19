/**
 * iPhoneウィジェット用のScriptable台本（docs/spec.md §28）。
 *
 * 台本は利用者の端末で動く。DaySpan側の画面ではないため、ここではReactやTailwindではなく
 * Scriptableが持つ描画APIだけで組む。エンドポイントとトークンは設定画面で埋め込んで配り、
 * 利用者に値を貼り込ませない。
 *
 * 中身をテンプレート文字列ではなく差し込み記号で持つのは、台本の側でJavaScriptの
 * テンプレートリテラル（`${...}`）を使えるようにするため。二重にエスケープすると、
 * 台本を読んだときにそのまま動く形に見えなくなる。
 */

const ENDPOINT_MARK = "__DAYSPAN_ENDPOINT__";
const TOKEN_MARK = "__DAYSPAN_TOKEN__";
const APP_URL_MARK = "__DAYSPAN_APP_URL__";
const WEBAPP_URL_MARK = "__DAYSPAN_WEBAPP_URL__";
const REFRESH_MARK = "__DAYSPAN_REFRESH_MINUTES__";

/**
 * 台本が次の更新を要求する間隔（分）。iOSがこのとおりに更新するとは限らない目安値。
 *
 * 更新のたびにGoogle Calendarへ1回問い合わせるため、短くするほど外部APIへの往復が増える
 * （docs/spec.md §20「過剰なアクセスを発生させない」）。画面の案内文もこの値から作る。
 *
 * ロック画面ぶんを足すとウィジェットの数だけ更新が走るため、今日の合計は
 * サーバー側で短時間だけ持ち回す（services/activity/today-cache.ts）。往復の数は
 * ウィジェットの数ではなくその保持時間で決まる。
 */
export const WIDGET_REFRESH_MINUTES = 5;

export function buildScriptableWidgetScript(options: {
  /** ウィジェットが読むAPIの絶対URL。 */
  endpoint: string;
  /** ウィジェット用トークン。未発行なら空文字を渡す（台本の見本として使う）。 */
  token: string;
  /** ウィジェットを押したときに開くDaySpanのURL。 */
  appUrl: string;
}): string {
  return SCRIPTABLE_TEMPLATE.replaceAll(ENDPOINT_MARK, escapeForJsString(options.endpoint))
    .replaceAll(TOKEN_MARK, escapeForJsString(options.token))
    .replaceAll(APP_URL_MARK, escapeForJsString(options.appUrl))
    .replaceAll(WEBAPP_URL_MARK, escapeForJsString(toWebAppUrl(options.appUrl)))
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
 * ウィジェットを押したときに開くURL。設定画面の案内とコピー用に使う。
 *
 * 台本の中でも同じ組み立てをしている（`OPEN_URL`）。iOSのウィジェット編集画面
 * （長押し ▸ ウィジェットを編集）の `URL` 欄へ入れる値がこれで、そこは利用者が手で
 * 入力する欄のため、ホスト名を打ち間違えても気付ける場所が実機のウィジェット（何も出ない）
 * しかない。台本と同じく、値はこちらで作って渡す。
 *
 * `app` が null になるのは `http` のアドレス（LAN経由の開発サーバー等）で開いたとき。
 * httpのサイトはWebアプリとしてホーム画面へ追加できず、`webapp://` の宛先になりようがない。
 */
export function buildWidgetOpenUrls(origin: string): { app: string | null; browser: string } {
  const webApp = toWebAppUrl(origin);

  return {
    app: webApp ? `${webApp}${WIDGET_OPEN_PATH}` : null,
    browser: `${origin}${WIDGET_OPEN_PATH}`,
  };
}

/**
 * 開く先のパス。記録の画面。
 *
 * `webapp://` ではiOSがパスを無視して最初の画面から開くが、ブラウザで開くときはこのパスが効く。
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

const SCRIPTABLE_TEMPLATE = String.raw`// DaySpan 活動記録ウィジェット
//
// 設定 > iPhoneウィジェット から生成された台本です。
// トークンが入っているので、そのまま他人へ渡さないでください。
//
// 使い方: Scriptableで新しいスクリプトを作り、この内容を貼り付けて保存します。
// ホーム画面を長押し > ウィジェットを追加 > Scriptable > このスクリプトを選びます。
//
// ウィジェットを押したときと、Scriptableの一覧でこの台本のアイコンを押したときは、
// どちらもDaySpanが開きます（ウィジェットの見本は表示しません）。

const ENDPOINT = "__DAYSPAN_ENDPOINT__";
const TOKEN = "__DAYSPAN_TOKEN__";
const APP_URL = "__DAYSPAN_APP_URL__";

// ホーム画面に追加したDaySpan（Webアプリ）を開くためのURL。iOS 16.4以降のスキームです。
// httpのアドレスで作った台本では空になります（httpのサイトはWebアプリとして追加できないため）。
const WEBAPP_URL = "__DAYSPAN_WEBAPP_URL__";

// 押したときに開く先。
//   "app"     … ホーム画面に追加したDaySpan
//   "browser" … ブラウザ（ホーム画面に追加していないときはこちらにしてください）
const OPEN_IN = "app";

// 次の更新までの目安（分）。iOSは要求どおりに更新するとは限りません。
const REFRESH_MINUTES = __DAYSPAN_REFRESH_MINUTES__;

// DaySpanの画面と同じ配色。記録中だけ色を変え、色でも記録中かどうかが分かるようにする。
const RUN_BG = Color.dynamic(new Color("#eaddff"), new Color("#4f378b"));
const RUN_INK = Color.dynamic(new Color("#21005d"), new Color("#eaddff"));
const IDLE_BG = Color.dynamic(new Color("#fef7ff"), new Color("#1d1b20"));
const IDLE_INK = Color.dynamic(new Color("#1d1b20"), new Color("#e6e0e9"));
// 目盛りの下地。文字色から作れないため、明暗のどちらでも沈まない灰色を薄く敷く。
const TRACK = new Color("#8a8a8a", 0.3);

const FAMILY = config.widgetFamily || "small";
const IS_ACCESSORY = FAMILY.indexOf("accessory") === 0;

// 押したときに開く先。ウィジェットの中では記録を start / stop できないため、
// 「止めたい」と思った操作がそのまま画面へつながるようにする。
//
// iOSは webapp:// のパスを無視し、Webアプリの最初の画面から開きます（すでに開いていたときは
// 前の画面のまま）。それでも /activity を付けているのは、ブラウザで開くときにはこのパスが効き、
// 同じ組み立てで両方をまかなえるためです。
const OPEN_URL = (OPEN_IN === "app" && WEBAPP_URL ? WEBAPP_URL : APP_URL) + "/activity";

if (config.runsInWidget) {
  const data = await load();
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

async function load() {
  try {
    const request = new Request(ENDPOINT);
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
  const running = summary ? summary.running : null;

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
  } else if (FAMILY === "accessoryCircular") {
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

  return widget;
}

// --- ホーム画面（小） ---
// 「いま何を、どれだけ続けているか」の1つだけ。経過時間をいちばん大きい字にする。

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

// --- ホーム画面（中） ---
// 左に記録中の1件、右に今日の内訳。

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

// --- ロック画面 ---
// 色が使えないため、形と文字だけで読める並びにする。

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

function addHeader(container, ink, label, running) {
  const row = container.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.spacing = 5;

  if (running) addDot(row, ink, 8);

  const text = addText(row, ink, label, Font.semiboldSystemFont(11));
  text.textOpacity = 0.75;
  text.lineLimit = 1;
  row.addSpacer();
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
`;
