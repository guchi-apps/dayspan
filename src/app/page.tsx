import { redirect } from "next/navigation";

export default function Home() {
  // 未ログインの場合は proxy.ts のミドルウェアが /login へ送る。
  redirect("/calendar");
}
