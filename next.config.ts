import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
