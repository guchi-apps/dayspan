"use client";

import { useEffect } from "react";
import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import { useOffline } from "next/offline";

import { dropOfflinePage } from "@/components/offline/offline-page-cache";
import { Button } from "@/components/ui/button";
import { DEFAULT_HOME_PATH } from "@/lib/home-path";

/**
 * 画面を描く途中で例外が出たときの面（issue #407）。
 *
 * これを置くまで、サーバー側で投げた例外はNext.jsの汎用のエラー画面へ落ちていた。英語の
 * 短い一文だけで、何の画面が失敗したのかも、もう一度試せることも、開き直せば直るのかも
 * 画面から分からない。勤務の画面がNotionの400で開けなくなったとき（issue #402）に利用者へ
 * 見えていたのはその面で、同じ症状が別の画面で出れば同じように読めない面になる。
 *
 * 個々の画面が外部APIの失敗を受け止めるのが先で（勤務の画面・カレンダー・タスクはそうしている）、
 * ここはその網から漏れたものを受ける最後の一枚。原因は画面から特定できないため、伝えるのは
 * 「一時的なものかもしれない」「もう一度試せる」「戻れる」の3つに絞る。
 *
 * 例外の中身（error.message）は出さない。本番のサーバー側の例外はNext.jsが伏せてdigestだけを
 * 渡すため手元に無く、クライアント側の例外はそのまま出しても利用者の操作に結び付かない。
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // ここでは `navigator.onLine` を足さない（isOfflineNow を使わない）。この面へ来ているのは
  // 画面の描画が失敗したときで、その失敗が通信によるものならNext.js自身の要求が落ちており、
  // `useOffline()` は true になっている。描画中に navigator を読むと、サーバーとブラウザで
  // 値が食い違ってハイドレーションが一致しなくなる。
  const offline = useOffline();

  useEffect(() => {
    // ブラウザのコンソールにも残す。サーバーのログと突き合わせる手掛かりはdigestしか無い。
    console.error("[dayspan] screen error:", error);

    // この面が出たということは、いま返ってきた応答がエラーだったということ。シェルが流れた
    // あとの例外は HTTP 200 で返るため Service Worker には正常なページに見えており、
    // 捨てておかないと、次にオフラインになったときにこの面が保存済みとして再生される。
    dropOfflinePage(window.location.pathname + window.location.search);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-error-container text-on-error-container">
          {offline ? <CloudOff className="size-7" /> : <AlertTriangle className="size-7" />}
        </div>

        <h1 className="type-title-large">画面を表示できませんでした</h1>

        <p className="type-body-medium text-muted-foreground">
          {offline
            ? "オフラインのため、この画面を作れませんでした。通信が戻ってからもう一度試してください。"
            : "一時的な不具合か、Google・Notionからの応答が返らなかった可能性があります。もう一度試すか、時間をおいて開き直してください。"}
        </p>

        {error.digest && (
          // 同じ症状を伝えるときの手掛かり。サーバーのログの同じ文字列と結び付く。
          <p className="type-body-small text-muted-foreground">エラーID: {error.digest}</p>
        )}
      </div>

      <div className="flex w-full max-w-sm flex-col gap-2">
        <Button onClick={reset}>
          <RefreshCw />
          もう一度試す
        </Button>

        {/*
          Linkではなく素のリンクにする。ここへ来ている時点でこのルートの描画は失敗しており、
          ソフトナビゲーションで移ると壊れた側の状態を引き継いだまま次の画面を描くことになる。
          文書ごと作り直せば、起動・再読み込みと同じ経路（Service Workerを含む）に乗る。
        */}
        <Button asChild variant="ghost">
          <a href={DEFAULT_HOME_PATH}>記録へ戻る</a>
        </Button>
      </div>
    </div>
  );
}
