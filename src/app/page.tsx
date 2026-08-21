import { redirect } from "next/navigation";

import { DEFAULT_HOME_PATH } from "@/lib/home-path";

export default function Home() {
  // 未ログインの場合は proxy.ts のミドルウェアが /login へ送る。
  redirect(DEFAULT_HOME_PATH);
}
