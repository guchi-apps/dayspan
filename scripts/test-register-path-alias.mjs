import { register } from "node:module";

// `node --import ./scripts/test-register-path-alias.mjs --test ...` から呼ぶ。
// フック本体（resolve）を別ファイルに置くのは、`register()` がフックを別スレッドで
// 読み込むため、自分自身を指すと登録処理そのものがそのスレッドでも動いてしまうため。
register("./test-path-alias-hooks.mjs", import.meta.url);
