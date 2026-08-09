/**
 * 初期リリースは所有者本人のみ利用可能とする（docs/spec.md §3）。
 * 許可メールアドレスは環境変数 ALLOWED_GOOGLE_EMAILS にカンマ区切りで設定する。
 *
 * 将来の一般公開時にこの関数を「常にtrue」へ変えるだけで済むよう、判定を1箇所に閉じている。
 * 未設定のまま誰でも入れる状態になるのを避けるため、未設定時は全員拒否とする。
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;

  const allowed = (process.env.ALLOWED_GOOGLE_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return false;

  return allowed.includes(email.toLowerCase());
}
