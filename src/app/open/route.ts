/**
 * iPhoneウィジェットの飛び先になる受け渡しページ（docs/spec.md §28・issue #562）。
 *
 * ここは認証を通さない（`src/lib/supabase/middleware.ts` の `isNoAuthPath()`）。Safari側に
 * セッションが無くても、Supabaseへ到達できなくても、ホーム画面のDaySpanへ渡すところまでは
 * 必ず動く必要があるため。返すHTMLは要求ごとに変わらず、利用者に紐づく値も持たない。
 */

import { buildWidgetOpenBridgeHtml } from "@/lib/widget-open-bridge";

/**
 * 要求ごとに変わらないので、ビルド時に組み立てて静的に配る。ウィジェットを押した直後の待ちは
 * そのまま「押しても開かない」に見えるため、渡すだけのページを毎回作り直さない。
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(buildWidgetOpenBridgeHtml(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
