import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_HOME_PATH, isStartPath, resolveInternalPath, startPathLabel } from "@/lib/home-path";

test("resolveInternalPath: 安全なnextパラメータをCookie値より優先する", () => {
  assert.equal(resolveInternalPath("/tasks", "/work"), "/tasks");
});

test("resolveInternalPath: nextが無ければ許可されたCookie値を使う", () => {
  assert.equal(resolveInternalPath(undefined, "/work"), "/work");
  assert.equal(resolveInternalPath(null, "/shopping"), "/shopping");
});

test("resolveInternalPath: nextもCookie値も無ければ既定へ落ちる", () => {
  assert.equal(resolveInternalPath(undefined, undefined), DEFAULT_HOME_PATH);
  assert.equal(resolveInternalPath(null, null), DEFAULT_HOME_PATH);
});

test("resolveInternalPath: 許可リストに無いCookie値は無視する", () => {
  assert.equal(resolveInternalPath(undefined, "/evil"), DEFAULT_HOME_PATH);
  assert.equal(resolveInternalPath(undefined, "/settings"), DEFAULT_HOME_PATH);
});

test("resolveInternalPath: 外部サイトを指すnextはCookie値へ落ちる（issue #596の対策を維持）", () => {
  assert.equal(resolveInternalPath("//evil.com", "/work"), "/work");
  assert.equal(resolveInternalPath("/\\evil.com", "/work"), "/work");
  assert.equal(resolveInternalPath("https://evil.com", "/work"), "/work");
});

test("isStartPath: 下部ナビ5画面のみ許可する", () => {
  assert.equal(isStartPath("/calendar"), true);
  assert.equal(isStartPath("/tasks"), true);
  assert.equal(isStartPath("/activity"), true);
  assert.equal(isStartPath("/work"), true);
  assert.equal(isStartPath("/shopping"), true);
  assert.equal(isStartPath("/settings"), false);
  assert.equal(isStartPath(undefined), false);
  assert.equal(isStartPath(null), false);
  assert.equal(isStartPath(""), false);
});

test("startPathLabel: 選択肢のパスからラベルを引く", () => {
  assert.equal(startPathLabel("/work"), "勤務");
  assert.equal(startPathLabel("/shopping"), "買い物");
});

test("startPathLabel: 未設定・不正な値は記録に寄せる", () => {
  assert.equal(startPathLabel(undefined), "記録");
  assert.equal(startPathLabel("/evil"), "記録");
});
