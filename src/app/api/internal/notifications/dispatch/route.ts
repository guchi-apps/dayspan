import { requireInternalApiKey } from "@/lib/internal-auth";
import { runTick } from "@/services/notifications/scheduler";

/**
 * 通知の送信を1回ぶん走らせる（docs/internal-api.md）。
 *
 * 通常はアプリ内のタイマー（instrumentation.ts）が毎分呼ぶ。この入口を別に置くのは、
 * 手で確かめられるようにするためと、将来VPSのcronから叩く形へ移せるようにするため。
 * 二重に走っても、送信済みの印を送る前に立てているため同じ通知は2回送られない。
 */
export async function POST(request: Request) {
  const denied = requireInternalApiKey(request);
  if (denied) return denied;

  await runTick();

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
