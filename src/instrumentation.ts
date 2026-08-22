/**
 * サーバーが起動したときに1回だけ走る（Next.js の instrumentation）。
 *
 * ここで通知のタイマーを始める（docs/spec.md §32）。時刻が来たことに気付けるのはサーバーだけで、
 * 画面を開いていない間も送る必要があるため、リクエストの外に置き場所が要る。
 */
export async function register(): Promise<void> {
  // Edgeランタイムでも呼ばれる。node:crypto とPrismaを使うため、Node側でだけ動かす。
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startNotificationScheduler } = await import("@/services/notifications/scheduler");
  startNotificationScheduler();
}
