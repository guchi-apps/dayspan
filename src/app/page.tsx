import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolveInternalPath, START_PATH_COOKIE } from "@/lib/home-path";

export default async function Home() {
  // 未ログインの場合は proxy.ts のミドルウェアが /login へ送る。
  const cookieStore = await cookies();
  redirect(resolveInternalPath(undefined, cookieStore.get(START_PATH_COOKIE)?.value));
}
