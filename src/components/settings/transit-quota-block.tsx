import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatQuotaDate,
  formatQuotaDateTime,
  isQuotaExhausted,
  isQuotaLow,
  quotaPercent,
  quotaUsed,
  type TransitQuota,
} from "@/lib/transit-quota";

/**
 * 経路検索API（NAVITIME）の利用枠（docs/spec.md §29「経路検索の利用状況」）。
 *
 * 出すのは「使った回数 / 上限」「残り回数」「リセット日」の3つだけにする。無料枠を
 * 使い切ったかどうかを知るために開く区画で、それ以上の内訳は判断の材料にならない。
 *
 * **取れなかったときは区画ごと出さない。** 呼び出し元が空・null を渡してくる状態は、
 * trainrouteと連携していない＝NAVITIMEを一度も呼んでいないということで、出す数字が存在しない。
 * 「取得できませんでした」を設定画面に常駐させても、利用者にできることは無い。
 */
export function TransitQuotaBlock({
  quotas,
  timeZone,
}: {
  quotas: TransitQuota[] | null;
  timeZone: string;
}) {
  if (!quotas || quotas.length === 0) return null;

  return (
    <div className="flex flex-col gap-5">
      {quotas.map((quota) => (
        <QuotaRow key={quota.key} quota={quota} timeZone={timeZone} />
      ))}
    </div>
  );
}

function QuotaRow({ quota, timeZone }: { quota: TransitQuota; timeZone: string }) {
  const used = quotaUsed(quota);
  const percent = quotaPercent(quota);
  const low = isQuotaLow(quota);
  const exhausted = isQuotaExhausted(quota);

  const resetDate = formatQuotaDate(quota.resetAt, timeZone);
  const updatedAt = formatQuotaDateTime(quota.updatedAt, timeZone);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-label-large">経路検索（{quota.label}）</span>

        {used !== null && (
          <span className="type-body-small tabular-nums text-on-surface-variant">
            {/* 色だけで危うさを示さない。数字そのものにも色を乗せるが、
                同時に下の「残りわずか」の文字が付く。 */}
            <b className={cn("type-title-small", low && "text-destructive")}>{used}</b> /{" "}
            {quota.limit} 回
          </span>
        )}
      </div>

      {percent !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
          <div
            className={cn("h-full rounded-full", low ? "bg-destructive" : "bg-travel")}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}

      {/* 使い切ったときは出さない。「残り0回」も「9月3日にリセット」も下の1文が言っている。 */}
      {!exhausted && (
        <div className="type-body-small flex flex-wrap items-center gap-x-2.5 gap-y-1 tabular-nums text-on-surface-variant">
          {low && <Badge variant="destructive">残りわずか</Badge>}
          <span>残り{quota.remaining}回</span>
          {resetDate && (
            <>
              <span aria-hidden>·</span>
              <span>{resetDate}にリセット</span>
            </>
          )}
        </div>
      )}

      {/* 使い切ったことより、代わりに何が起きるかを書く。移動そのものはいつでも作れて、
          所要時間の出どころが変わるだけ、というのが利用者にとっての違いのため。
          DaySpanはこの枠を消費しなくなったので（下記）、電車の所要時間には影響しない。 */}
      {exhausted && (
        <p className="type-body-small rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
          枠を使い切りました。
          {resetDate ? `${resetDate}まで` : "リセットされるまで"}
          は、この経路検索を使う他のアプリが所要時間を調べられません。
        </p>
      )}

      {/* **DaySpanはこの枠を使わない。** 電車の所要時間はYahoo!乗換案内から取り込む形へ
          変えたため（docs/spec.md §29）、ここに出るのは同じ窓口を使う他のアプリの消費。
          数字だけを出すと、DaySpanで移動を作るたびに減っていくものだと読める。 */}
      <p className="type-body-small text-on-surface-variant">
        DaySpanの電車の所要時間はYahoo!乗換案内から入れるため、この枠は使いません。
        {quota.source === "local"
          ? "trainrouteが自分の呼び出しを数えた概算のため、他のアプリからの分は含みません。"
          : "数えているのはtrainrouteで、AIDEなど他のアプリからの分も含みます。"}
        {updatedAt && `経路検索をしたときに更新されます（最終更新 ${updatedAt}）。`}
      </p>
    </div>
  );
}
