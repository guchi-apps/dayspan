/** サーバー間参照API（`/api/internal/*`）の対象ユーザーを指定するヘッダー（docs/internal-api.md）。 */
export const TARGET_EMAIL_HEADER = "x-target-email";

export type TargetEmail = { kind: "none" } | { kind: "email"; email: string } | { kind: "invalid" };

/**
 * ヘッダー値を対象メールへ正規化する。DBに依存しない純粋関数。
 * 未指定・空は none、複数（カンマ）や形の崩れた値は invalid（いずれも別人を返さない）。
 */
export function parseTargetEmail(value: string | null): TargetEmail {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return { kind: "none" };
  if (!/^[^\s@,]+@[^\s@,]+$/.test(trimmed)) return { kind: "invalid" };
  return { kind: "email", email: trimmed.toLowerCase() };
}
