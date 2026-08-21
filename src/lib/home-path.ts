/**
 * アプリを開いたときに最初に出す画面（issue #299）。
 *
 * 記録は「いま何かを始める・終える」その瞬間の操作で、探してから押すのでは間に合わない
 * （docs/spec.md §4・§27）。メインナビの先頭に置いているのと同じ理由で、起動直後の画面も
 * ここにする。
 *
 * 設定で選ばせないのは、PWAの `start_url`（src/app/manifest.ts）が静的でユーザーごとに
 * 出し分けられないため。設定に持たせても、ホーム画面から起動した場合には効かない。
 */
export const DEFAULT_HOME_PATH = "/activity";

/**
 * ログイン後の戻り先（`next` / `callbackUrl`）を、外部へ飛ばされない形に整える。
 *
 * `//` 始まりを弾くのは、`//example.com` がプロトコル相対URLとして外部サイトを指すため。
 * 判定を1か所に置くのは、`/auth/signin`・`/auth/callback`・`/login`・ミドルウェアの4経路で
 * 同じ既定値を使う必要があり、`start_url` とずれるとiPhoneウィジェットの着地点の前提
 * （docs/spec.md §28）まで崩れるため。
 */
export function resolveInternalPath(param: string | null | undefined): string {
  return param && param.startsWith("/") && !param.startsWith("//") ? param : DEFAULT_HOME_PATH;
}
