"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** コピーボタンの識別子。どのボタンで「コピーしました」を出すかを決めるために使う。 */
type CopyTarget = "authorization" | "startUrl" | "stopUrl" | "sleepUrl";

/**
 * iPhoneショートカットの設定（docs/spec.md §40）。
 *
 * ウィジェット（`widget-section.tsx`）は台本を1本コピーさせれば終わるが、ショートカットは
 * 文字列として配れない。オートメーションは利用者が端末の画面でアクションを1つずつ並べる
 * ものなので、ここでは**入れる値をコピーさせ、手順をiOSの画面に出ているとおりの名前で並べる**。
 *
 * 打ち間違いに気付ける場所が実機のオートメーション（何も起きない）しかないため、URLと
 * `Authorization` ヘッダーの値は手で組み立てさせずコピーさせる。
 */
export function ShortcutsSection({
  initialToken,
  lastUsedLabel,
  endpointBase,
  sleepTitle,
}: {
  /** 発行済みのトークン。未発行なら null。 */
  initialToken: string | null;
  /**
   * 最後にショートカットから呼ばれた日時。設定タイムゾーンで整形済みの文字列を受け取る。
   * ここで日時を組み立てると、サーバー（UTC）とブラウザ（JST）で結果が変わり
   * ハイドレーションが一致しない（CLAUDE.md）。
   */
  lastUsedLabel: string | null;
  /** 送り先のURLの共通部分（`https://…/api/shortcuts`）。 */
  endpointBase: string;
  /** 睡眠として数える活動記録の項目名。何という名前で記録されるのかを画面に出すため。 */
  sleepTitle: string;
}) {
  const router = useRouter();

  const [token, setToken] = useState(initialToken);
  const [revealed, setRevealed] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issue = async (regenerate: boolean) => {
    if (regenerate) {
      // 作り直すと、いま置いてあるオートメーションはその時点で通らなくなる。
      // 気付ける場所が実機（何も起きない）しかないため、実行の前に示す。
      const confirmed = window.confirm(
        "トークンを作り直します。\niPhoneに作ってあるオートメーションは、新しいトークンに貼り替えるまで記録できなくなります。よろしいですか？",
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/shortcuts", { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        token?: string;
        message?: string;
      } | null;

      if (!response.ok || !body?.token) {
        setError(body?.message ?? "トークンを発行できませんでした。");
        return;
      }

      setToken(body.token);
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
      "トークンを削除します。\niPhoneのオートメーションから記録できなくなります。よろしいですか？",
    );
    if (!confirmed) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/shortcuts", { method: "DELETE" });
      if (!response.ok) {
        setError("トークンを削除できませんでした。");
        return;
      }

      setToken(null);
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
   * クリップボードへ入れる。
   *
   * navigator.clipboard は https か localhost でしか使えない。LAN経由のhttpで開いている
   * ときは失敗するため、その場合は画面に出ている値を選んでコピーしてもらう案内へ倒す
   * （ウィジェットの台本と同じ扱い）。
   */
  const copy = async (target: CopyTarget, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTarget(target);
      setError(null);
      // 別のボタンを押したあとに前のタイマーが起きても、いま出ている印を消さない。
      window.setTimeout(() => setCopiedTarget((prev) => (prev === target ? null : prev)), 2000);
    } catch {
      setError("コピーできませんでした。上の値を選択してコピーしてください。");
    }
  };

  const authorization = token ? `Bearer ${token}` : "";
  const startUrl = `${endpointBase}/sleep/start`;
  const stopUrl = `${endpointBase}/sleep/stop`;
  const sleepUrl = `${endpointBase}/sleep`;

  /**
   * 送り先の一覧の1行。コピーボタンを持つのはこの一覧だけにする。
   *
   * 同じURLにコピーボタンを2つ置くと、片方を押したときに離れたもう片方まで
   * 「コピーしました」に変わり、押していないボタンが反応したように見える。
   */
  const copyRow = (target: CopyTarget, value: string) => (
    <>
      <code className="type-body-small min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
        {value}
      </code>
      <Button variant="outline" size="sm" onClick={() => copy(target, value)}>
        {copiedTarget === target ? <Check className="size-4" /> : <Copy className="size-4" />}
        {copiedTarget === target ? "コピーしました" : "コピー"}
      </Button>
    </>
  );

  /** アクションの箱に出す値。コピーは上の「送り先」から行う。 */
  const urlRow = (value: string) => (
    <code className="type-body-small min-w-0 flex-1 overflow-x-auto whitespace-nowrap">
      {value}
    </code>
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p className="type-body-medium rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
            {error}
          </p>
        )}

        {!token ? (
          <div className="flex flex-col gap-3">
            <p className="type-body-medium text-on-surface-variant">
              就寝と起床は、まさにアプリを開いて押せない時刻です。iPhoneの個人用オートメーション
              からDaySpanを呼べば、記録の画面で押したときとまったく同じ経路で
              「{sleepTitle}」の記録になります。
            </p>
            <p className="type-body-medium text-on-surface-variant">
              トークンを発行すると、オートメーションに入れる値（送り先のURLと
              <code className="mx-1">Authorization</code>ヘッダー）をコピーできるようになります。
              このトークンでできるのは睡眠の記録だけで、予定やタスクは読み書きできません。
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

              {/* 効いているかどうかを画面から読めるようにする。オートメーションは人が見て
                  いない時点で走るため、届いているかを確かめる場所がほかに無い。 */}
              <p className="type-body-small text-on-surface-variant">
                {lastUsedLabel
                  ? `最後にショートカットから呼ばれたのは ${lastUsedLabel} です。`
                  : "まだショートカットから呼ばれていません。"}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => copy("authorization", authorization)}>
                {copiedTarget === "authorization" ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copiedTarget === "authorization"
                  ? "コピーしました"
                  : "Authorization の値をコピー"}
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

            {/*
              3経路ぶんの送り先。どれも同じ Authorization ヘッダーで、変わるのはURLだけ。
              並べておけば、どのオートメーションにどれを入れるのかを見比べられる。
            */}
            <span className="type-label-large text-on-surface-variant">送り先</span>

            <dl className="flex flex-col gap-2">
              <SettingRow label="就寝時">{copyRow("startUrl", startUrl)}</SettingRow>
              <SettingRow label="起床時">{copyRow("stopUrl", stopUrl)}</SettingRow>
              <SettingRow label="ヘルスケア">{copyRow("sleepUrl", sleepUrl)}</SettingRow>
            </dl>

            <p className="type-body-small text-on-surface-variant">
              どれも<code className="mx-1">POST</code>で呼び、ヘッダーに
              <code className="mx-1">Authorization</code>（値は上の「Authorization の値をコピー」）
              を付けます。記録される項目名は「{sleepTitle}」です（設定 ▸ 活動記録 で変えられます）。
            </p>

            {/*
              iOSのショートカットAppのアクション名は日本語表記なので、そのまま日本語で並べる。
              Scriptableの英語のままの画面（widget-section.tsx）と扱いが違うのはこのため。
            */}
            <span className="type-label-large text-on-surface-variant">
              就寝時に記録を始める（オートメーション）
            </span>

            <ol className="type-body-medium flex list-decimal flex-col gap-1 pl-5 text-on-surface-variant">
              <li>
                ショートカットApp → <span className="text-on-surface">オートメーション</span> →
                右上の ＋
              </li>
              <li>
                <span className="text-on-surface">睡眠</span> を選び、
                <span className="text-on-surface">就寝時</span> →{" "}
                <span className="text-on-surface">すぐに実行</span>（実行の前に尋ねる をオフ）
              </li>
              <li>
                アクションに <span className="text-on-surface">URLの内容を取得</span> を足し、
                下のとおりに設定する
              </li>
              <li>
                続けて <span className="text-on-surface">辞書の値を取得</span> を足し、キーに
                <code className="mx-1">message</code>、値の取得元に前のアクションの結果を選ぶ
              </li>
              <li>
                最後に <span className="text-on-surface">通知を表示</span> を足す（効いているか
                どうかが端末で読めます。慣れたら外してかまいません）
              </li>
            </ol>

            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
              <span className="type-label-large text-on-surface-variant">
                URLの内容を取得（就寝時）
              </span>

              <dl className="flex flex-col gap-2">
                <SettingRow label="URL">{urlRow(startUrl)}（上の「送り先 ▸ 就寝時」）</SettingRow>
                <SettingRow label="方法">POST</SettingRow>
                <SettingRow label="ヘッダ">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span>
                      キー: <code>Authorization</code>
                    </span>
                    <span>
                      テキスト: <code>Bearer …</code>
                      （上の「Authorization の値をコピー」で入る値）
                    </span>
                  </div>
                </SettingRow>
                <SettingRow label="要求のボディ">
                  <span>なし（時刻は受け取った時点のサーバーの時計で決まります）</span>
                </SettingRow>
              </dl>
            </div>

            <span className="type-label-large text-on-surface-variant">
              起床時に記録を止める（オートメーション）
            </span>

            <ol className="type-body-medium flex list-decimal flex-col gap-1 pl-5 text-on-surface-variant">
              <li>
                同じく オートメーション → ＋ →{" "}
                <span className="text-on-surface">アラーム</span> を選ぶ
              </li>
              <li>
                <span className="text-on-surface">停止したとき</span> →{" "}
                <span className="text-on-surface">すぐに実行</span>
              </li>
              <li>
                アクションは就寝時と同じ並びで、URLだけ
                <code className="mx-1">{stopUrl}</code>に変える
              </li>
            </ol>

            {/* ここが「押さえておく点」のいちばん効くところ。オートメーションは人が見ていない
                時点で走るため、何が起きるのかを設定画面に書いておく。 */}
            <p className="type-body-small text-on-surface-variant">
              起床時の呼び出しは、記録中が「{sleepTitle}」のときだけ止めます。前の晩に止め忘れた
              別の記録が動いていても、それが朝まで伸びた予定になることはありません
              （そのときは、記録中の項目名を添えて「止めませんでした」と返ります）。
            </p>
            <p className="type-body-small text-on-surface-variant">
              就寝時の呼び出しは、その夜すでに「{sleepTitle}」を記録中なら何もしません。
              オートメーションが二重に走っても、同じ夜の睡眠が2件に割れることはありません。
              前の夜の記録が止まらないまま残っていたときは、そこまでを予定にしてから始め直します
              （アラームが鳴らなかった朝でも、記録が何日も伸び続けることはありません）。
            </p>

            <span className="type-label-large text-on-surface-variant">
              ヘルスケアの実測値をまとめて送る
            </span>

            <p className="type-body-medium text-on-surface-variant">
              Apple Watchなどで測った睡眠を、起きたあとにまとめて記録する場合はこちらを使います。
              上の2つのオートメーションの代わりに使っても、併用してもかまいません
              （すでに同じ時間帯の「{sleepTitle}」があれば、重ねて作りません）。
            </p>

            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
              <span className="type-label-large text-on-surface-variant">
                URLの内容を取得（ヘルスケア）
              </span>

              <dl className="flex flex-col gap-2">
                <SettingRow label="URL">{urlRow(sleepUrl)}（上の「送り先 ▸ ヘルスケア」）</SettingRow>
                <SettingRow label="方法">POST</SettingRow>
                <SettingRow label="ヘッダ">
                  <span>
                    就寝時と同じ（<code className="mx-1">Authorization</code>）
                  </span>
                </SettingRow>
                <SettingRow label="要求のボディ">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span>
                      JSON。次のどれかの形で送ります（日時は
                      <code className="mx-1">2026-09-08T23:35:00+09:00</code>のような形式）。
                    </span>
                    <dl className="flex flex-col gap-0.5">
                      <BodyShape shape='{"start": …, "end": …}'>
                        睡眠分析の開始・終了をそのまま送る
                      </BodyShape>
                      <BodyShape shape='{"end": …, "minutes": 430}'>
                        起床時刻と、実測の睡眠時間（分）
                      </BodyShape>
                      <BodyShape shape='{"minutes": 430}'>
                        睡眠時間（分）だけ。終わりは受け取った時点になります
                      </BodyShape>
                    </dl>
                  </div>
                </SettingRow>
              </dl>
            </div>

            <div className="type-body-small flex flex-col gap-1 text-on-surface-variant">
              <p>
                送り先のURLは、いまこの画面を開いているアドレスから作られています。iPhoneから
                見られるアドレスで開いてコピーしてください。
              </p>
              <p>
                記録の保存先は活動記録と同じカレンダーです（設定 ▸ 活動記録）。書ける
                カレンダーが1つも無いときは記録できず、その理由が通知に出ます。保存先を選んで
                いないときは予定作成の既定のカレンダーへ入り、記録はできますが
                <span className="text-on-surface">記録 ▸ 睡眠</span>
                の画面には出ません（そのことも通知に出ます）。
              </p>
              <p>
                入れた記録は<span className="text-on-surface">記録 ▸ 睡眠</span>の画面に、
                夜ごとに横へ並びます。
              </p>
              <p>
                トークンはこの画面からいつでも作り直せます。作り直したときは、オートメーションの
                <code className="mx-1">Authorization</code>も新しい値へ貼り替えてください。
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * ショートカットのアクションの1行（項目名と入れる値）。
 *
 * 狭い画面では項目名を値の上へ折り返す。URLは横並びのままだと数文字しか見えなくなる
 * （`widget-section.tsx` の SettingRow と同じ寸法）。
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

/** 送れる本文の形と、その使いどころ。 */
function BodyShape({ shape, children }: { shape: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <dt className="type-body-small font-mono">{shape}</dt>
      <dd className="type-body-small text-on-surface-variant">{children}</dd>
    </div>
  );
}

/** 前後だけ残して伏せる。どのトークンかは見分けられ、盗み見では使えない長さにする。 */
function maskToken(token: string): string {
  if (token.length <= 16) return "••••••••";
  return `${token.slice(0, 10)}${"•".repeat(12)}${token.slice(-4)}`;
}
