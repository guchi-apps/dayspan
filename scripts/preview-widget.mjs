#!/usr/bin/env node
// iPhoneウィジェットの台本（src/lib/scriptable-widget.ts）を、実機もScriptableも使わずに
// 手元で走らせて中身を出す。
//
// 台本は利用者の端末でしか動かないため、面（activity / schedule / tasks / shopping）と
// 枠（small / medium / large / ロック画面3種）の掛け算ぶんの見え方を、変更のたびに実機へ
// 貼り替えて確かめることになる。Scriptableの描画APIは ListWidget / Stack / Text の木を
// 組み立てるだけなので、そこを差し替えれば「どの枠に何行が入るか」「空のとき・未設定のとき・
// 取得に失敗したときに何が出るか」は手元で読める。
//
// 使い方:
//   node scripts/preview-widget.mjs                 … 全ての面 × 枠
//   node scripts/preview-widget.mjs schedule        … 面を絞る
//   node scripts/preview-widget.mjs tasks small     … 面と枠を絞る
//   node scripts/preview-widget.mjs schedule --case=empty
//
// 確かめられないもの: 実際の文字幅・折り返し・SFSymbolの有無・タイマー表示の進み方。
// それらは実機でしか分からない。ここで見るのは中身と行数と文言。

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const FAMILIES = [
  "small",
  "medium",
  "large",
  "accessoryRectangular",
  "accessoryCircular",
  "accessoryInline",
];

const [viewArg, familyArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const caseArg = (process.argv.slice(2).find((a) => a.startsWith("--case=")) ?? "").slice(7);

/**
 * 台本の本文を取り出す。
 *
 * scriptable-widget.ts は他のモジュールを一切importしないため、tscで1ファイルだけ
 * JavaScriptへ落とせば、そのまま読み込んで関数を呼べる（型だけのimportしか持たない
 * モジュールを手元で動かすときの常套手段）。
 */
async function loadTemplate() {
  const out = mkdtempSync(join(tmpdir(), "dayspan-widget-"));

  execFileSync(
    join(root, "node_modules/.bin/tsc"),
    [
      join(root, "src/lib/scriptable-widget.ts"),
      "--outDir",
      out,
      "--module",
      "es2022",
      "--target",
      "es2022",
      "--moduleResolution",
      "bundler",
    ],
    { stdio: "inherit" },
  );

  const loaded = await import(join(out, "scriptable-widget.js"));

  return loaded.buildScriptableWidgetScript({
    endpointBase: "https://example.test/api/widget",
    token: "dummy-token",
    appUrl: "https://example.test",
  });
}

/** 台本を1回走らせ、組み上がったウィジェットの木を文字にして返す。 */
async function render(source, { view, family, body }) {
  let built = null;

  const globals = {
    // --- Scriptableの描画API（組み立てだけを写す） ---
    ListWidget: class extends Stack {
      constructor() {
        super("widget");
      }
      setPadding() {}
    },
    Stack,
    Color: makeColor(),
    Font: makeConstant("Font"),
    Size: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
    },
    DateFormatter: class {
      string(date) {
        return date.toISOString().slice(11, 16);
      }
    },
    SFSymbol: { named: (name) => ({ image: `[${name}]` }) },
    Script: { setWidget: (widget) => (built = widget), complete: () => {} },
    Safari: { open: () => {} },
    Request: makeRequest(body),

    // --- 実行の文脈 ---
    config: { runsInWidget: true, widgetFamily: family },
    args: { widgetParameter: view === "activity" ? "" : view },
  };

  const names = Object.keys(globals);
  const run = new Function(...names, `return (async () => {\n${source}\n})();`);

  // 台本の先頭はトップレベル await を使う。非同期関数の中へ入れてから待つ。
  await run(...names.map((name) => globals[name]));

  return built ? built.describe(0).trimEnd() : "(ウィジェットが組み立てられませんでした)";
}

// --- Scriptableの木の写し ---

class Stack {
  constructor(kind = "stack") {
    this.kind = kind;
    this.children = [];
  }
  addStack() {
    const stack = new Stack();
    this.children.push(stack);
    return stack;
  }
  addText(value) {
    const text = { kind: "text", value, centerAlignText() {}, leftAlignText() {}, rightAlignText() {} };
    this.children.push(text);
    return text;
  }
  addDate(date) {
    const node = {
      kind: "date",
      value: date.toISOString(),
      applyTimerStyle() {},
      centerAlignText() {},
    };
    this.children.push(node);
    return node;
  }
  addImage(image) {
    const node = { kind: "image", value: String(image) };
    this.children.push(node);
    return node;
  }
  addSpacer(size) {
    this.children.push({ kind: "spacer", value: size === undefined ? "flex" : String(size) });
  }
  layoutHorizontally() {
    this.horizontal = true;
  }
  layoutVertically() {
    this.horizontal = false;
  }
  centerAlignContent() {}

  describe(depth) {
    const pad = "  ".repeat(depth);
    let out = "";

    for (const child of this.children) {
      if (child instanceof Stack) {
        // 中身の無い箱（区切り線・優先度の帯）は、あることだけ示す。
        if (child.children.length === 0) {
          out += `${pad}·\n`;
          continue;
        }
        out += `${pad}${child.horizontal ? "→" : "↓"}\n${child.describe(depth + 1)}`;
        continue;
      }
      if (child.kind === "spacer") continue;
      if (child.kind === "text") out += `${pad}"${child.value}"\n`;
      if (child.kind === "date") out += `${pad}<タイマー ${child.value}>\n`;
      if (child.kind === "image") out += `${pad}<印 ${child.value}>\n`;
    }

    return out;
  }
}

function makeColor() {
  const color = class {
    constructor(hex) {
      this.hex = hex;
    }
  };
  color.dynamic = (light) => light;
  color.white = () => new color("#ffffff");
  return color;
}

/** Font.systemFont(11) のような呼び出しを、どれも同じ値で受け流す。 */
function makeConstant(name) {
  return new Proxy(
    {},
    { get: (_target, key) => () => `${name}.${String(key)}` },
  );
}

function makeRequest(body) {
  return class {
    constructor(url) {
      this.url = url;
      this.response = { statusCode: body === null ? 500 : 200 };
    }
    async loadJSON() {
      if (body === null) throw new Error("network");
      return body;
    }
  };
}

// --- 固定のダミー応答 ---

function fixtureFor(view, name) {
  if (name === "error") return null;

  const now = "2026-09-06T10:54:00.000Z";
  const timeZone = "UTC";

  if (view === "activity") {
    if (name === "empty") {
      return { timeZone, now, running: null, today: null, todayUnavailable: "calendar_not_selected" };
    }
    return {
      timeZone,
      now,
      running: { title: "仕事", calendarId: "c", startedAt: "2026-09-06T09:30:00.000Z", elapsedMinutes: 84 },
      today: {
        date: "2026-09-06",
        totalMinutes: 252,
        items: [
          { title: "仕事", minutes: 125 },
          { title: "睡眠", minutes: 88 },
          { title: "読書", minutes: 25 },
        ],
        last: { title: "読書", endedAt: "2026-09-06T09:10:00.000Z" },
      },
      todayUnavailable: null,
    };
  }

  if (view === "schedule") {
    if (name === "empty") {
      return { timeZone, now, date: "2026-09-06", items: [], unavailable: null };
    }
    if (name === "unset") {
      return { timeZone, now, date: "2026-09-06", items: [], unavailable: "google_not_connected" };
    }
    return {
      timeZone,
      now,
      date: "2026-09-06",
      items: [
        { kind: "event", title: "社内研修ウィーク", allDay: true, start: null, end: null, detail: null, mode: null, outcome: null, past: false },
        { kind: "event", title: "チーム定例", allDay: false, start: "2026-09-06T14:00:00.000Z", end: "2026-09-06T15:00:00.000Z", detail: "会議室B", mode: null, outcome: null, past: false },
        { kind: "event", title: "歯科検診", allDay: false, start: "2026-09-06T16:30:00.000Z", end: "2026-09-06T17:00:00.000Z", detail: "なかもず歯科", mode: null, outcome: null, past: false },
        { kind: "travel", title: "大阪駅", allDay: false, start: "2026-09-06T17:40:00.000Z", end: "2026-09-06T18:05:00.000Z", detail: "25分", mode: "PUBLIC_TRANSIT", outcome: null, past: false },
        { kind: "event", title: "朝会", allDay: false, start: "2026-09-06T10:00:00.000Z", end: "2026-09-06T10:15:00.000Z", detail: null, mode: null, outcome: "CANCELED", past: true },
        { kind: "event", title: "資源ごみ出し", allDay: false, start: "2026-09-06T08:30:00.000Z", end: "2026-09-06T08:40:00.000Z", detail: null, mode: null, outcome: null, past: true },
      ],
      unavailable: null,
    };
  }

  if (view === "tasks") {
    if (name === "empty") {
      return { timeZone, now, overdueCount: 0, todayCount: 0, total: 0, items: [], unavailable: null };
    }
    if (name === "unset") {
      return { timeZone, now, overdueCount: 0, todayCount: 0, total: 0, items: [], unavailable: "notion_not_connected" };
    }
    return {
      timeZone,
      now,
      overdueCount: 2,
      todayCount: 2,
      total: 6,
      items: [
        { title: "請求書を送る", bucket: "overdue", dueLabel: "3日超過", priority: "高" },
        { title: "健康診断の予約フォーム", bucket: "overdue", dueLabel: "1日超過", priority: "中" },
        { title: "資料をまとめる", bucket: "today", dueLabel: "今日 17:00", priority: "中" },
        { title: "部屋の模様替えを考える", bucket: "today", dueLabel: "今日", priority: null },
        { title: "歯医者を予約", bucket: "upcoming", dueLabel: "9/8", priority: null },
        { title: "本を返す", bucket: "upcoming", dueLabel: "9/12", priority: null },
      ],
      unavailable: null,
    };
  }

  if (name === "empty") return { timeZone, now, remaining: 0, items: [], unavailable: null };
  if (name === "unset") {
    return { timeZone, now, remaining: 0, items: [], unavailable: "shopping_not_ready" };
  }
  return {
    timeZone,
    now,
    remaining: 8,
    items: [
      { name: "牛乳", category: "食品", priority: "高" },
      { name: "食器用洗剤", category: "日用品", priority: "中" },
      { name: "単4電池", category: null, priority: null },
      { name: "みりん", category: "食品", priority: null },
      { name: "歯ブラシ", category: "日用品", priority: null },
    ],
    unavailable: null,
  };
}

// 実行はいちばん最後に置く。上の class 宣言より前に呼ぶと、まだ初期化されていない
// （クラス宣言は巻き上がるが、評価される前は参照できない）。
const script = await loadTemplate();

const views = viewArg ? [viewArg] : ["activity", "schedule", "tasks", "shopping"];
const families = familyArg ? [familyArg] : FAMILIES;

for (const view of views) {
  const body = fixtureFor(view, caseArg || "normal");

  for (const family of families) {
    console.log(`\n=== ${view} / ${family}${caseArg ? ` / ${caseArg}` : ""} ===`);
    console.log(await render(script, { view, family, body }));
  }
}
