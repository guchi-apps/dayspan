"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** コピーボタンの識別子。どのボタンで「コピーしました」を出すかを決めるために使う。 */
type CopyTarget = "script" | "bridgeUrl" | "appUrl" | "browserUrl";

/**
 * iPhoneウィジェットの設定（docs/spec.md §28）。
 *
 * Scriptableはブラウザのログインセッションを持てないため、専用トークンを発行して
 * 台本の中へ埋め込んで配る。利用者がURLやトークンを手で貼り込む工程を作らない。
 * 打ち間違いに気付ける場所が実機のウィジェット（何も出ない）しかないため。
 *
 * 台本は面（活動記録・今日の予定・タスク・買い物リスト）ごとに分けず1本だけ配り、
 * どの面を出すかは `Parameter` で選ばせる。分けると貼り付けが面の数だけ増える。
 */
export function WidgetSection({
  initialToken,
  initialScript,
  lastUsedLabel,
  openUrls,
  refreshMinutes,
  viewChoices,
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
  /**
   * ウィジェットを押したときに開くURL。iOSのウィジェット編集画面へ手で入れる値。
   * `bridge` はHTTPSの受け渡しページ（既定）、`app` は `webapp://` を直接開く従来の値で
   * http のアドレスで開いているときに null（`webapp://` を組み立てられないため）。
   */
  openUrls: { bridge: string; app: string | null; browser: string };
  refreshMinutes: number;
  /**
   * `Parameter` に入れられる値。台本を組み立てるモジュールから渡してもらう。
   * ここでimportすると台本の本文がクライアントのJavaScriptに付いてくる。
   */
  viewChoices: { value: string; label: string; description: string }[];
}) {
  const router = useRouter();

  const [token, setToken] = useState(initialToken);
  const [script, setScript] = useState(initialScript);
  const [revealed, setRevealed] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
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
      setCopiedTarget(null);
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
      setCopiedTarget(null);
      router.refresh();
    } catch {
      setError("トークンを削除できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  /**
   * クリップボードへ入れる。台本とURLで同じ経路を通す。
   *
   * navigator.clipboard は https か localhost でしか使えない。LAN経由のhttpで開いている
   * ときは失敗するため、その場合は画面に出ている値を選んでコピーしてもらう案内へ倒す。
   * どこを選べばよいかは対象で違うため、案内文は呼び出し側から渡す。
   */
  const copy = async (target: CopyTarget, text: string, hint: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      setError(null);
      // 別のボタンを押したあとに前のタイマーが起きても、いま出ている印を消さない。
      window.setTimeout(() => setCopiedTarget((prev) => (prev === target ? null : prev)), 2000);
    } catch {
      setError(`コピーできませんでした。${hint}`);
    }
  };

  // ウィジェット編集画面の `URL` 欄へ入れる値。HTTPSの受け渡しページを既定にする
  // （issue #562）。`webapp://` を直接入れると、端末によっては押してもScriptableが開くだけで
  // 先へ進まない。httpsのURLなら必ず開けるので、渡す先の判断はページ側に持たせる。
  const openUrl = openUrls.bridge;
  const openUrlTarget: CopyTarget = "bridgeUrl";

  // `webapp://` を直接開くURL。ここでconstへ受けるのは、押されたときに走るコールバックの中で
  // 型の絞り込みが効かなくなるため（プロパティのままだと非nullアサーションが要る）。
  const directAppUrl = openUrls.app;

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
              コピーできるようになります。台本でできるのは読み取りだけ（活動記録・今日の予定・
              タスク・買い物リスト）で、予定やタスクを書き換えることはできません。
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
              <Button
                disabled={busy}
                onClick={() =>
                  copy("script", script, "下の「台本を見る」を開いて、内容を選択してコピーしてください。")
                }
              >
                {copiedTarget === "script" ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copiedTarget === "script" ? "コピーしました" : "台本をコピー"}
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

            <span className="type-label-large text-on-surface-variant">ホーム画面に置く</span>

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
              <li>
                置いたウィジェットを長押し → <span className="text-on-surface">ウィジェットを編集</span>
                を押し、下のとおりに設定する
              </li>
            </ol>

            {/*
              iOSのウィジェット編集画面の写し。Scriptableのこの画面は英語表記のままなので、
              ラベルは画面に出ているとおりの英語で並べる。訳語にすると、どの行のことか
              端末の画面と見比べられない。
            */}
            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
              <span className="type-label-large text-on-surface-variant">
                ウィジェットを編集（Scriptable）
              </span>

              <dl className="flex flex-col gap-2">
                <SettingRow label="Script">
                  DaySpan<span className="text-on-surface-variant">（4で付けた名前）</span>
                </SettingRow>
                <SettingRow label="When Interacting">Open URL</SettingRow>
                <SettingRow label="URL">
                  {/* 打ち間違いに気付ける場所が実機のウィジェット（何も出ない）しかないため、
                      値はコピーさせる。httpのアドレスで開いているときは webapp:// を作れないので、
                      ブラウザで開くURLをそのまま案内する。 */}
                  <code className="type-body-small min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
                    {openUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      copy(openUrlTarget, openUrl, "上のURLを選択してコピーしてください。")
                    }
                  >
                    {copiedTarget === openUrlTarget ? (
                      <Check className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                    {copiedTarget === openUrlTarget ? "コピーしました" : "コピー"}
                  </Button>
                </SettingRow>
                {/*
                  何を出すかはこの欄で決まる。台本を面ごとに分けず1本だけ配るため、
                  ここが唯一の切り替え口になる。値を間違えるとウィジェットには
                  「Parameterには … のいずれかを入れてください」が出る。
                */}
                <SettingRow label="Parameter">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-on-surface-variant">
                      出したいものの名前（空のままなら活動記録）
                    </span>
                    <dl className="flex flex-col gap-0.5">
                      {viewChoices.map((choice) => (
                        <div key={choice.value} className="flex flex-wrap items-baseline gap-x-2">
                          <dt className="type-body-small font-mono">{choice.value}</dt>
                          <dd className="type-body-small text-on-surface-variant">
                            {choice.label}
                            <span className="mx-1">—</span>
                            {choice.description}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </SettingRow>
              </dl>

              <p className="type-body-small text-on-surface-variant">
                同じ台本をホーム画面にいくつも置き、枠ごとに<code className="mx-1">Parameter</code>
                を変えれば、活動記録・今日の予定・タスク・買い物リストを同時に並べられます。
                台本を貼り替える必要はありません。
              </p>

              {/*
                この欄はiOS側の設定で、DaySpanからは変えられない。以前の案内（webapp:// を直接）で
                置いた枠は、貼り替えるまで押しても何も起きないままになる（issue #562）。
              */}
              <p className="type-body-small text-on-surface-variant">
                上の<code className="mx-1">URL</code>
                は、ホーム画面に追加したDaySpanへ切り替えるための受け渡しページです。端末によっては
                <code className="mx-1">webapp://</code>
                で始まるURLを直接開けず、押してもScriptableが開くだけで先へ進みません。httpsのURLなら
                必ず開けるため、いったんこのページを開き、そこからDaySpanへ切り替えます。切り替わらな
                かったときは、そのページからブラウザで開けます。
              </p>

              <p className="type-body-small text-on-surface-variant">
                すでにウィジェットを置いているときも、この<code className="mx-1">URL</code>
                欄を新しい値へ貼り替えてください。台本を貼り替えるだけでは変わりません。
              </p>

              <details className="type-body-small text-on-surface-variant">
                <summary className="cursor-pointer">別の開き方にする</summary>

                <div className="flex flex-col gap-2 pt-2">
                  {directAppUrl ? (
                    <p className="flex flex-wrap items-center gap-2">
                      <span>
                        受け渡しページを挟まず、ホーム画面のDaySpanを直接開くときは、URLに
                        <code className="mx-1">{directAppUrl}</code>
                        を入れ、台本の先頭にある<code className="mx-1">OPEN_IN</code>も
                        <code className="mx-1">&quot;app-direct&quot;</code>
                        に変えてください。直接開ける端末では、こちらのほうが速く開きます。
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          copy("appUrl", directAppUrl, "上のURLを選択してコピーしてください。")
                        }
                      >
                        {copiedTarget === "appUrl" ? (
                          <Check className="size-4" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                        {copiedTarget === "appUrl" ? "コピーしました" : "直接開く用をコピー"}
                      </Button>
                    </p>
                  ) : (
                    <p>
                      いまhttpのアドレスでこの画面を開いているため、ホーム画面のDaySpanを直接開くURL
                      （<code className="mx-1">webapp://</code>
                      ）は作れません。httpsのアドレスで開き直すと、そちらのURLも出ます。
                    </p>
                  )}

                  <p className="flex flex-wrap items-center gap-2">
                    <span>
                      ホーム画面に追加していないときや、ブラウザで開きたいときは、URLに
                      <code className="mx-1">{openUrls.browser}</code>
                      を入れ、<code className="mx-1">OPEN_IN</code>も
                      <code className="mx-1">&quot;browser&quot;</code>に変えてください。
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        copy("browserUrl", openUrls.browser, "上のURLを選択してコピーしてください。")
                      }
                    >
                      {copiedTarget === "browserUrl" ? (
                        <Check className="size-4" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                      {copiedTarget === "browserUrl" ? "コピーしました" : "ブラウザ用をコピー"}
                    </Button>
                  </p>
                </div>
              </details>
            </div>

            {/*
              ロック画面はホーム画面と入口も枠の形も違う。手順を書かないと、置けることに気付けない。
              枠ごとに出るものが変わるのは、iOSがロック画面のウィジェットに渡す大きさが
              3種類あり、入る行数がそれぞれ違うため（台本の renderCircular / renderRectangular /
              renderInline）。
            */}
            <span className="type-label-large text-on-surface-variant">ロック画面に置く</span>

            <ol className="type-body-medium flex list-decimal flex-col gap-1 pl-5 text-on-surface-variant">
              <li>
                ロック画面を長押し → <span className="text-on-surface">カスタマイズ</span> →
                ロック画面 を押す
              </li>
              <li>時計の下のウィジェットの枠を押す</li>
              <li>一覧から Scriptable を選び、置きたい形を押す</li>
              <li>
                置いたウィジェットを押して、スクリプトに「DaySpan」を選ぶ（
                <code className="mx-1">When Interacting</code>と
                <code className="mx-1">URL</code>は上と同じ値にする）
              </li>
              <li>右上の完了 → 画面を押して閉じる</li>
            </ol>

            <ul className="type-body-small flex list-disc flex-col gap-1 pl-5 text-on-surface-variant">
              <li>丸い枠: 件数（活動記録では経過時間）と、何の数かを示す一言</li>
              <li>横長の枠: 見出しと2行（いちばん多く読める）</li>
              <li>
                時計の上の1行: 次の予定や件数を1つだけ（活動記録では経過時間。この枠には1つしか
                置けません）
              </li>
            </ul>

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
                DaySpanが開きます。iOSの仕様でWebアプリは最初の画面から開きます（すでに開いていた
                ときは前の画面のまま）。最初の画面は記録のため、押すとそのまま記録の画面になります。
                以前にホーム画面へ追加した端末でカレンダーが開くときは、いったん削除してから
                追加し直してください。
              </p>
              <p>
                押してもScriptableが開いてしまうときは、ウィジェットを編集の
                <code className="mx-1">When Interacting</code>が
                <code className="mx-1">Run Script</code>のままです。上のとおりに直してください。
              </p>
              <p>
                記録中の経過時間はiOSが数えるため、常に進みます。それ以外の中身は約
                {refreshMinutes}分ごとの更新で取り直します（iOSの都合で前後します）。別の端末で
                記録を止めたときは、次の更新までウィジェットが記録中のまま進み続けます。
              </p>
              <p>
                同じものを見る枠が複数あっても外部への問い合わせが増えないよう、取得した内容は
                サーバー側で3分だけ持ち回します。DaySpanの画面で買い物にチェックを付けたり
                タスクを完了にした直後は、ウィジェットに反映されるまで最大3分かかります。
              </p>
              <p>
                今日の合計と内訳は、活動記録の保存先カレンダーを選んでいるときだけ出せます
                （設定 ▸ 活動記録）。今日の予定はGoogleカレンダーの接続、タスクと買い物リストは
                NotionのDB設定が要ります。足りないときは、ウィジェットに何を設定すればよいかが出ます。
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * ウィジェット編集画面の1行（項目名と入れる値）。
 *
 * 狭い画面では項目名を値の上へ折り返す。`When Interacting` は横並びのままだと値の幅を奪い、
 * URLが数文字しか見えなくなる。
 */
function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-high px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
      <dt className="type-body-small shrink-0 font-mono text-on-surface-variant sm:w-36">
        {label}
      </dt>
      <dd className="type-body-medium flex min-w-0 flex-1 items-center gap-2">{children}</dd>
    </div>
  );
}

/** 前後だけ残して伏せる。どのトークンかは見分けられ、盗み見では使えない長さにする。 */
function maskToken(token: string): string {
  if (token.length <= 16) return "••••••••";
  return `${token.slice(0, 10)}${"•".repeat(12)}${token.slice(-4)}`;
}
