"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * iPhoneウィジェットの設定（docs/spec.md §28）。
 *
 * Scriptableはブラウザのログインセッションを持てないため、専用トークンを発行して
 * 台本の中へ埋め込んで配る。利用者がURLやトークンを手で貼り込む工程を作らない。
 * 打ち間違いに気付ける場所が実機のウィジェット（何も出ない）しかないため。
 */
export function WidgetSection({
  initialToken,
  initialScript,
  lastUsedLabel,
  refreshMinutes,
}: {
  /** 発行済みのトークン。未発行なら null。 */
  initialToken: string | null;
  /** トークンを埋め込んだ台本。未発行なら null。 */
  initialScript: string | null;
  /**
   * 最後にウィジェットから読まれた日時。設定タイムゾーンで整形済みの文字列を受け取る。
   * ここで日時を組み立てると、サーバー（UTC）とブラウザ（JST）で結果が変わり
   * ハイドレーションが一致しない（CLAUDE.md）。
   */
  lastUsedLabel: string | null;
  refreshMinutes: number;
}) {
  const router = useRouter();

  const [token, setToken] = useState(initialToken);
  const [script, setScript] = useState(initialScript);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async (regenerate: boolean) => {
    if (regenerate) {
      // 作り直すと、いま動いている端末のウィジェットはその時点で読めなくなる。
      // 押し間違えたときに気付ける場所が実機しかないため、実行の前に示す。
      const confirmed = window.confirm(
        "トークンを作り直します。\nいま使っている端末のウィジェットは、新しい台本に貼り替えるまで表示できなくなります。よろしいですか？",
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/widget", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        token?: string;
        script?: string;
        message?: string;
      } | null;

      if (!response.ok || !body?.token || !body?.script) {
        setError(body?.message ?? "トークンを発行できませんでした。");
        return;
      }

      setToken(body.token);
      setScript(body.script);
      setRevealed(false);
      setCopied(false);
      router.refresh();
    } catch {
      setError("トークンを発行できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const confirmed = window.confirm(
      "トークンを削除します。\nすべての端末のウィジェットが表示できなくなります。よろしいですか？",
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/widget", { method: "DELETE" });
      if (!response.ok) {
        setError("トークンを削除できませんでした。");
        return;
      }

      setToken(null);
      setScript(null);
      setRevealed(false);
      setCopied(false);
      router.refresh();
    } catch {
      setError("トークンを削除できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  /**
   * 台本をクリップボードへ入れる。
   *
   * navigator.clipboard は https か localhost でしか使えない。LAN経由のhttpで開いている
   * ときは失敗するため、その場合は下の台本を選んでコピーしてもらう案内へ倒す。
   */
  const copy = async () => {
    if (!script) return;

    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setError(null);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("コピーできませんでした。下の「台本を見る」を開いて、内容を選択してコピーしてください。");
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        {!token || !script ? (
          <div className="flex flex-col gap-3">
            <p className="type-body-medium text-on-surface-variant">
              トークンを発行すると、そのトークンを埋め込んだ台本（Scriptable用のスクリプト）を
              コピーできるようになります。台本でできるのは活動記録の読み取りだけで、
              予定やタスクの読み書きはできません。
            </p>
            <div>
              <Button disabled={busy} onClick={() => issue(false)}>
                トークンを発行する
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <span className="type-label-large text-on-surface-variant">トークン</span>

              <div className="flex items-center gap-2">
                {/* 肩越しに見られている場面もあるため、既定では伏せる。 */}
                <code className="type-body-small min-w-0 flex-1 truncate rounded-lg bg-surface-container-high px-3 py-2">
                  {revealed ? token : maskToken(token)}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevealed((prev) => !prev)}
                  aria-label={revealed ? "トークンを隠す" : "トークンを表示する"}
                >
                  {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>

              <p className="type-body-small text-on-surface-variant">
                {lastUsedLabel
                  ? `最後にウィジェットから読まれたのは ${lastUsedLabel} です。`
                  : "まだウィジェットから読まれていません。"}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={copy}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {copied ? "コピーしました" : "台本をコピー"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => issue(true)}>
                <RefreshCw className="size-4" />
                作り直す
              </Button>
              <Button variant="destructive" disabled={busy} onClick={remove}>
                <Trash2 className="size-4" />
                削除
              </Button>
            </div>

            <ol className="type-body-medium flex list-decimal flex-col gap-1 pl-5 text-on-surface-variant">
              <li>
                iPhoneのSafariでDaySpanを開き、共有 → <span className="text-on-surface">ホーム画面に追加</span>
                （ウィジェットから開く先がこのアプリになります）
              </li>
              <li>App Storeから「Scriptable」を入れる</li>
              <li>
                上の<span className="text-on-surface">台本をコピー</span>を押す
              </li>
              <li>Scriptableで新しいスクリプトを作り、貼り付けて「DaySpan」と名前を付ける</li>
              <li>
                ホーム画面を長押し → ウィジェットを追加 → Scriptable →
                スクリプトに「DaySpan」を選ぶ
              </li>
            </ol>

            <details className="rounded-lg bg-surface-container-high">
              <summary className="type-body-medium cursor-pointer px-3 py-2">台本を見る</summary>
              <pre className="type-body-small max-h-80 overflow-auto px-3 pb-3 whitespace-pre">
                {script}
              </pre>
            </details>

            <div className="type-body-small flex flex-col gap-1 text-on-surface-variant">
              <p>
                台本の中のURLは、いまこの画面を開いているアドレスから作られます。iPhoneから
                見られるアドレスで開いてコピーしてください。
              </p>
              <p>
                ウィジェットと、Scriptableの一覧にある台本のアイコンを押すと、ホーム画面に追加した
                DaySpanが開きます。iOSの仕様でWebアプリは最初の画面（カレンダー）から開きます
                （すでに開いていたときは前の画面のまま）。記録の画面はメインナビの先頭にあります。
              </p>
              <p>
                ホーム画面に追加していないときや、ブラウザで開きたいときは、台本の先頭にある
                <code className="mx-1">OPEN_IN</code>を<code className="mx-1">&quot;browser&quot;</code>
                に変えてください。
              </p>
              <p>
                ウィジェットは約{refreshMinutes}分ごとの更新を要求します（iOSの都合で前後します）。
                経過時間は更新した時点の値で止まり、次の更新まで進みません。
              </p>
              <p>
                今日の合計と内訳は、活動記録の保存先カレンダーを選んでいるときだけ出せます
                （設定 ▸ 活動記録）。
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** 前後だけ残して伏せる。どのトークンかは見分けられ、盗み見では使えない長さにする。 */
function maskToken(token: string): string {
  if (token.length <= 16) return "••••••••";
  return `${token.slice(0, 10)}${"•".repeat(12)}${token.slice(-4)}`;
}
