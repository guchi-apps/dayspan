import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

// proxy.ts の config.matcher は、Next.jsがビルド時にASTから静的に値を取り出す
// （extractExportedConstValue）。ここでは文字列リテラル・配列・オブジェクトの
// リテラルしか解決できず、他ファイルからimportした定数への参照は
// `Unknown identifier` として無視されるため、matcher文字列は proxy.ts に
// リテラルのまま書く必要がある（切り出してimportする形にできない）。
// そのためこのテストは proxy.ts のソースを直接読み込み、そこに書かれている
// 正規表現が意図どおりの挙動になっているかを確かめる（issue #839）。
const proxySourcePath = fileURLToPath(new URL("./proxy.ts", import.meta.url));
const proxySource = readFileSync(proxySourcePath, "utf8");

function buildMatcherRegExp(): RegExp {
  const match = proxySource.match(/matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"/);
  assert.ok(match, "src/proxy.ts から config.matcher の文字列を取り出せませんでした");
  const source = JSON.parse(`"${match[1]}"`) as string;
  return new RegExp(`^${source}$`);
}

test("画像の拡張子で終わる /api/* もmatcherを通る（proxyを経由する）", () => {
  const re = buildMatcherRegExp();
  assert.equal(re.test("/api/events/abc.png"), true);
  assert.equal(re.test("/api/tasks/abc.png"), true);
  assert.equal(re.test("/api/work/records/abc.png"), true);
});

test("通常のAPI・ページパスはmatcherを通る", () => {
  const re = buildMatcherRegExp();
  assert.equal(re.test("/api/calendar"), true);
  assert.equal(re.test("/calendar"), true);
  assert.equal(re.test("/login"), true);
});

test("Service Worker・アイコン・_next の静的アセットはmatcherから除外されたまま", () => {
  const re = buildMatcherRegExp();
  assert.equal(re.test("/favicon.ico"), false);
  assert.equal(re.test("/manifest.webmanifest"), false);
  assert.equal(re.test("/sw.js"), false);
  assert.equal(re.test("/apple-icon.png"), false);
  assert.equal(re.test("/icon.svg"), false);
  assert.equal(re.test("/_next/static/chunk.js"), false);
  assert.equal(re.test("/_next/image"), false);
});

test("/api/ 以外の画像拡張子パスはmatcherから除外されたまま", () => {
  const re = buildMatcherRegExp();
  assert.equal(re.test("/some-image.png"), false);
  assert.equal(re.test("/places/photo.jpg"), false);
});
