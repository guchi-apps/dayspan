import { pathToFileURL } from "node:url";

/**
 * `node --test` から `src/**\/*.test.mts` を直接動かすための、`@/` エイリアス解決フック。
 *
 * tsconfig の `paths`（`@/*` → `./src/*`）はバンドラー（Next.js）の中でしか効かない。
 * `node:module` の `register()` に登録して使う（`scripts/test-register-path-alias.mjs`）。
 * `format` を明示するのは、`package.json` に `"type"` が無い状態で `.ts` を読ませると
 * Nodeが中身を覗いてCommonJSかESMかを判定し直す（`MODULE_TYPELESS_PACKAGE_JSON` 警告）ため。
 * ここで解決する先はどれもESMのTypeScriptと分かっているので、判定させずに済ませる。
 */
const SRC_ROOT = pathToFileURL(`${process.cwd()}/src/`).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return {
      url: `${SRC_ROOT}${specifier.slice(2)}.ts`,
      format: "module-typescript",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
