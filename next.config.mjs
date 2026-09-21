// @ts-check

// 設定ファイルは .mjs にする（TypeScriptに戻さない）。next.config.ts だと、本番の `next start` が
// 設定ファイルをトランスパイルするためだけにSWCのネイティブバイナリを読み込み、そのまま常駐して
// PM2の常駐メモリ（VmHWM）とスレッド数が増える。型は下のJSDocで付ける（issue #675）。

/** @type {import("next").NextConfig} */
const nextConfig = {
  // スマートフォンからは <IP>.sslip.io で開く。IPは変わりうるためホスト名を直書きしない。
  //
  // ワイルドカードは "*" が1ラベル、"**" が複数ラベルに対応する。sslip.ioのホスト名は
  // IPがそのままラベルになる（192.168.2.114.sslip.io）ため、"*.sslip.io" では一致せず、
  // dev サーバーがJSチャンクをブロックしてハイドレーションが完了しなくなる。
  allowedDevOrigins: ["**.sslip.io"],

  experimental: {
    // オフライン中のナビゲーション・データ取得を例外にせず保留にし、再接続後に自動で送り直す。
    // next/offline の useOffline() はこのフラグが無いと常に false を返すため、
    // オフライン表示と書き込み禁止（docs/spec.md §21）もこのフラグに依存している。
    useOffline: true,
  },
};

export default nextConfig;
