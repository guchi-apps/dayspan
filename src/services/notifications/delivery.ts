/**
 * 同じ人がPWAとiOSアプリの両方で通知を許可したときの送り分け（docs/spec.md §32）。
 *
 * 同じ端末にアプリとホーム画面のPWAが並ぶと、同じ通知が2通届く。端末ごとに「どちらで受けるか」を
 * 選ばせると設定が1つ増え、選び忘れがそのまま二重通知か通知なしになる。そこで、アプリ（APNs）を
 * 登録している端末の系統（iPhone / iPad）では、同じ系統のWeb Pushの購読を送り先から外す。
 * アプリのほうを優先するのは、WKWebView・PWAのどちらよりもAPNsのほうが届く条件が緩く
 * （Web Pushは購読の失効・iOSの取り消しがある）、バッジも確実に更新できるため。
 *
 * 系統が分からない購読（label が null。Mac・Windows・Android以外のUA）は外さない。
 * PCのブラウザで受けている通知までiPhoneのアプリを入れただけで止めてしまうほうが困る。
 *
 * このファイルは他のモジュールを読み込まない（node --test から直接読めるようにするため）。
 */

export function webPushLabelsToSkip(apnsLabels: Array<string | null>): Set<string> {
  return new Set(apnsLabels.filter((label): label is string => Boolean(label)));
}

/** Web Pushの購読のうち、アプリで受ける端末の系統と重なるものを除く。 */
export function dropWebSubscriptionsCoveredByApp<T extends { label: string | null }>(
  subscriptions: T[],
  apnsLabels: Array<string | null>,
): T[] {
  const skip = webPushLabelsToSkip(apnsLabels);
  if (skip.size === 0) return subscriptions;
  return subscriptions.filter((subscription) => !subscription.label || !skip.has(subscription.label));
}
