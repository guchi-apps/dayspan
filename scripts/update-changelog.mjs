#!/usr/bin/env node
// アプリ内「更新履歴」画面（src/lib/changelog.ts）へ、リリース時のエントリを自動追記する。
//
// package.json の "version" lifecycle スクリプトから呼ばれる。
// release-develop-to-main.yml（issue-deckから移植したリリース自動化）が
// `npm version <新バージョン> --no-git-tag-version` を実行する際、
// コード差分から生成した利用者向けの更新履歴を環境変数 RELEASE_CHANGELOG で渡してくる。
// バンプコミットは `git add -A` で作られるため、ここで書き換えたファイルは自動的に含まれる。
//
// RELEASE_CHANGELOG が未設定・空のとき（ローカルで `npm version` を叩いた場合など）は
// 何もしない。ワークフロー側はこのリポジトリの書き込み先を一切知らない。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const changelogPath = join(repoRoot, "src/lib/changelog.ts");
const packageJsonPath = join(repoRoot, "package.json");

const raw = process.env.RELEASE_CHANGELOG ?? "";
if (raw.trim() === "") {
  console.log("RELEASE_CHANGELOG が空のため、更新履歴は変更しません。");
  process.exit(0);
}

// npm version は package.json を書き換えた後にこのスクリプトを実行するため、
// ここで読み直した値が新バージョンになる。
const version = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;

// 日付は表示先（日本のユーザー）に合わせてJSTで決める。ランナーはUTCのため、
// 実行時刻によっては1日ずれる。
const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
  new Date(),
);

// 生成される文面は箇条書き・段落のどちらもありうる。行単位に分解し、
// 箇条書き記号と番号を落として1行1項目にそろえる。
const changes = raw
  .split("\n")
  .map((line) => line.trim().replace(/^(?:[-*・]|\d+[.)])\s*/, "").trim())
  .filter((line) => line !== "");

if (changes.length === 0) {
  console.log("RELEASE_CHANGELOG から項目を抽出できなかったため、更新履歴は変更しません。");
  process.exit(0);
}

const source = readFileSync(changelogPath, "utf8");

// 同じバージョンのエントリが既にある場合は追記しない（リリースのやり直しで
// 同じバージョンが二重に並ばないようにする）。
if (new RegExp(`version:\\s*"${version.replace(/\./g, "\\.")}"`).test(source)) {
  console.log(`更新履歴に ${version} のエントリが既にあるため、追記しません。`);
  process.exit(0);
}

const marker = "export const APP_CHANGELOG: ChangelogEntry[] = [\n";
const markerIndex = source.indexOf(marker);
if (markerIndex === -1) {
  // 書き込み先を見失ったまま黙って成功すると、更新履歴が欠けたままリリースされる。
  console.error(`${changelogPath} に APP_CHANGELOG の定義が見つかりません。`);
  process.exit(1);
}

const escape = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const entry = [
  "  {",
  `    version: "${escape(version)}",`,
  `    date: "${date}",`,
  "    changes: [",
  ...changes.map((change) => `      "${escape(change)}",`),
  "    ],",
  "  },",
  "",
].join("\n");

const insertAt = markerIndex + marker.length;
writeFileSync(
  changelogPath,
  source.slice(0, insertAt) + entry + source.slice(insertAt),
  "utf8",
);

console.log(`更新履歴に ${version}（${date}）のエントリを ${changes.length} 件追記しました。`);
