/**
 * 通知の中身（docs/spec.md §32）。
 *
 * iOS 18.4以降のSafariは、`web_push: 8030` を持つJSONをService Workerを起こさずにそのまま
 * 通知として出す（Declarative Web Push）。それより前のiOSと他のブラウザは `push` イベントを
 * 受け取るため、public/sw.js が同じJSONの `notification` を読んで表示する。
 * 1つの形で両方を賄えるので、送信側は端末を見分けない。
 */

export type PushNotificationInput = {
  title: string;
  body: string;
  /** 押したときに開くDaySpan内のパス（`/calendar?date=2026-08-22` など）。 */
  path: string;
  /**
   * 同じ印を持つ通知は、新しいものが古いものを置き換える。
   * 記録の開始のように、最後の1件だけが意味を持つ通知で使う。
   */
  tag?: string;
  /** アイコンに出す件数。null なら触らない（0を送ると消える）。 */
  badge?: number | null;
};

export function buildPushPayload(input: PushNotificationInput, origin: string): string {
  const navigate = new URL(input.path, origin).toString();

  const notification: Record<string, unknown> = {
    title: input.title,
    body: input.body,
    navigate,
    lang: "ja",
  };

  if (input.tag) notification.tag = input.tag;
  if (typeof input.badge === "number") notification.app_badge = input.badge;

  return JSON.stringify({ web_push: 8030, notification });
}
