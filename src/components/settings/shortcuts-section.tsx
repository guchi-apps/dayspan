"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Eye, EyeOff, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MAX_RANGE_DAYS } from "@/lib/sleep-health";

/** コピーボタンの識別子。どのボタンで「コピーしました」を出すかを決めるために使う。 */
type CopyTarget = "authorization" | "startUrl" | "stopUrl" | "sleepUrl" | "healthUrl" | "healthRangeUrl";

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
  healthExportedLabel,
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
  /**
   * ヘルスケアへ送り終えた睡眠の終わり（整形済み）。まだ送っていなければ null。
   * 整形をサーバーで済ませる理由は `lastUsedLabel` と同じ。
   */
  healthExportedLabel: string | null;
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
  // 過去の睡眠を送る範囲（issue #665）。空のときはURLを作らない。
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

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
  const healthUrl = `${endpointBase}/sleep/health`;
  const rangeDays =
    rangeFrom && rangeTo
      ? Math.round((Date.parse(`${rangeTo}T00:00:00Z`) - Date.parse(`${rangeFrom}T00:00:00Z`)) / 86_400_000) + 1
      : null;
  const rangeError =
    rangeDays === null
      ? null
      : rangeDays < 1
        ? "開始日は終了日と同じ日か、それより前にしてください。"
        : rangeDays > MAX_RANGE_DAYS
          ? `一度に送れるのは${MAX_RANGE_DAYS}日までです（いまは${rangeDays}日）。`
          : null;
  const healthRangeUrl =
    rangeDays !== null && !rangeError ? `${healthUrl}?from=${rangeFrom}&to=${rangeTo}` : null;

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
              このトークンでできるのは睡眠の記録と、ヘルスケアへ送るための睡眠の読み取りだけで、
              予定やタスクは読み書きできません。
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
              <SettingRow label="ヘルスケアから">{copyRow("sleepUrl", sleepUrl)}</SettingRow>
              <SettingRow label="ヘルスケアへ">{copyRow("healthUrl", healthUrl)}</SettingRow>
            </dl>

            <p className="type-body-small text-on-surface-variant">
              どれもヘッダーに
              <code className="mx-1">Authorization</code>（値は上の「Authorization の値をコピー」）
              を付けます（方法は各手順を見てください）。記録される項目名は「{sleepTitle}」です（設定 ▸ 活動記録 で変えられます）。
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
                <SettingRow label="URL">{urlRow(sleepUrl)}（上の「送り先 ▸ ヘルスケアから」）</SettingRow>
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

            {/*
              DaySpan → ヘルスケア（docs/spec.md §40「ヘルスケアへ送る」）。ショートカットの
              ファイルは署名が要り（macOSかiCloudの共有でしか作れない）配れないため、
              ほかの経路と同じく手順を日本語のアクション名で並べる。
            */}
            <span className="type-label-large text-on-surface-variant">
              DaySpanの睡眠をヘルスケアへ送る（ショートカット）
            </span>

            <p className="type-body-medium text-on-surface-variant">
              記録の画面や上のオートメーションで付けた「{sleepTitle}」を、iPhoneのヘルスケアの
              睡眠分析へ書き込みます。Webアプリからはヘルスケアへ直接書けないため、
              ショートカットがDaySpanから「まだ送っていない{sleepTitle}」を受け取って書き込みます。
            </p>

            <p className="type-body-small text-on-surface-variant">
              {healthExportedLabel
                ? `${healthExportedLabel} までに終わった${sleepTitle}は送信済みです。`
                : `まだ送っていません。初回は直近2日ぶんの${sleepTitle}から送ります。`}
            </p>

            <ol className="type-body-medium flex list-decimal flex-col gap-1 pl-5 text-on-surface-variant">
              <li>
                ショートカットApp → <span className="text-on-surface">ショートカット</span> →
                右上の ＋ で新しいショートカットを作る（名前は例えば「睡眠をヘルスケアへ」）
              </li>
              <li>
                <span className="text-on-surface">URLの内容を取得</span> を足し、下の「受け取る」の
                とおりに設定する
              </li>
              <li>
                <span className="text-on-surface">辞書の値を取得</span> を足し、キーに
                <code className="mx-1">items</code>、取得元に「URLの内容」を選ぶ
              </li>
              <li>
                <span className="text-on-surface">各項目を繰り返す</span> を足し、対象に前の
                「辞書の値」を選ぶ
              </li>
              <li>
                繰り返しの中に <span className="text-on-surface">辞書の値を取得</span> を2つ足し、
                取得元はどちらも「繰り返し項目」、キーはそれぞれ
                <code className="mx-1">start</code>と<code className="mx-1">end</code>にする
              </li>
              <li>
                続けて繰り返しの中に <span className="text-on-surface">ヘルスケアサンプルを記録</span>
                を足し、種類 <span className="text-on-surface">睡眠分析</span>・値
                <span className="text-on-surface">睡眠中</span>、開始日に
                <code className="mx-1">start</code>の辞書の値、終了日に
                <code className="mx-1">end</code>の辞書の値を選ぶ
              </li>
              <li>
                繰り返しの後ろ（「繰り返しの終了」の下）に
                <span className="text-on-surface">URLの内容を取得</span> をもう1つ足し、下の
                「送り終えたと伝える」のとおりに設定する
              </li>
              <li>
                最後に <span className="text-on-surface">辞書の値を取得</span>（キー
                <code className="mx-1">message</code>）→{" "}
                <span className="text-on-surface">通知を表示</span> を足す
              </li>
              <li>
                一度ショートカットAppから手で実行し、ヘルスケアへの書き込みを許可する
              </li>
              <li>
                毎朝自動で送るには、上の「起床時に記録を止める」オートメーションの最後に
                <span className="text-on-surface">ショートカットを実行</span>
                を足してこのショートカットを選ぶ（止めた直後の{sleepTitle}がそのまま送られます）
              </li>
            </ol>

            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
              <span className="type-label-large text-on-surface-variant">
                URLの内容を取得（受け取る）
              </span>

              <dl className="flex flex-col gap-2">
                <SettingRow label="URL">{urlRow(healthUrl)}（上の「送り先 ▸ ヘルスケアへ」）</SettingRow>
                <SettingRow label="方法">GET</SettingRow>
                <SettingRow label="ヘッダ">
                  <span>
                    就寝時と同じ（<code className="mx-1">Authorization</code>）
                  </span>
                </SettingRow>
              </dl>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
              <span className="type-label-large text-on-surface-variant">
                URLの内容を取得（送り終えたと伝える）
              </span>

              <dl className="flex flex-col gap-2">
                <SettingRow label="URL">{urlRow(healthUrl)}（受け取ると同じ）</SettingRow>
                <SettingRow label="方法">POST</SettingRow>
                <SettingRow label="ヘッダ">
                  <span>
                    就寝時と同じ（<code className="mx-1">Authorization</code>）
                  </span>
                </SettingRow>
                <SettingRow label="要求のボディ">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span>
                      JSON。キー<code className="mx-1">until</code>・種類
                      <span className="mx-1">テキスト</span>、値は最初の「URLの内容」から
                      <span className="mx-1">辞書の値を取得</span>（キー
                      <code className="mx-1">until</code>）で取り出したもの
                    </span>
                    <span className="type-body-small text-on-surface-variant">
                      （「辞書の値を取得」をもう1つ、繰り返しの前に足しておくと選びやすくなります）
                    </span>
                  </div>
                </SettingRow>
              </dl>
            </div>

            <div className="type-body-small flex flex-col gap-1 text-on-surface-variant">
              <p>
                送り終えたと伝えるまでは、同じ{sleepTitle}が次の実行でも返ります。ヘルスケアへの
                書き込みを許可していない・途中で止まったときでも、その夜のぶんが送られないまま
                消えることはありません。
              </p>
              <p>
                「ヘルスケアから」で取り込んだ{sleepTitle}は送り返しません（同じ睡眠が
                ヘルスケアに2件並ばないように）。ただしこの仕組みより前に取り込んだものは
                見分けが付かないため、初回に直近2日ぶんを送るときだけ重なることがあります。
              </p>
              <p>
                送ったあとにDaySpanで時刻を直しても、ヘルスケアの側は変わりません。終わりを
                後ろへ直した{sleepTitle}は次の実行でもう一度送られ、送信済みの時刻より前に
                終わる{sleepTitle}をあとから入れたものは送られません。そのときはヘルスケアの
                睡眠分析で直接直してください。
              </p>
            </div>

            {/*
              過去の睡眠を送る（issue #665・一時的な機能）。新しいショートカットは要らず、
              上の受け取るURLを範囲つきのものへ差し替えて実行する。
            */}
            <div className="flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
              <span className="type-label-large text-on-surface-variant">
                過去の{sleepTitle}を選んで送る（一時的な機能）
              </span>

              <p className="type-body-small text-on-surface-variant">
                送り終えた印より前の{sleepTitle}も、日付を選べばヘルスケアへ送れます。
                起床した日で数え、一度に送れるのは{MAX_RANGE_DAYS}日までです。1日だけ送るときは
                同じ日を選びます。
              </p>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="date"
                  label="開始日"
                  variant="outlined"
                  value={rangeFrom}
                  onChange={(event) => setRangeFrom(event.target.value)}
                />
                <Input
                  type="date"
                  label="終了日"
                  variant="outlined"
                  value={rangeTo}
                  onChange={(event) => setRangeTo(event.target.value)}
                />
              </div>

              {rangeError && (
                <p className="type-body-small text-error">{rangeError}</p>
              )}

              {healthRangeUrl && (
                <dl className="flex flex-col gap-2">
                  <SettingRow label="URL">{copyRow("healthRangeUrl", healthRangeUrl)}</SettingRow>
                </dl>
              )}

              <ol className="type-body-small flex list-decimal flex-col gap-1 pl-5 text-on-surface-variant">
                <li>
                  上の「睡眠をヘルスケアへ」ショートカットで、最初の「URLの内容を取得（受け取る）」の
                  URLだけを、ここのURLへ差し替える（元のURLは控えておく）
                </li>
                <li>ショートカットを手で実行する（通知に送った件数が出ます）</li>
                <li>終わったら、URLを元に戻す</li>
              </ol>

              <p className="type-body-small text-on-surface-variant">
                「送り終えたと伝える」の手順はそのままで構いません（この送り方では印は動かず、
                毎朝の送信の範囲は変わりません）。ただし送った夜は記録されないため、
                <span className="text-on-surface">同じ範囲をもう一度送ると、ヘルスケアに同じ夜が
                2件並びます</span>。毎朝の送信ですでに送った夜や、Apple Watchで入っている夜と
                重なる日も同様です。ヘルスケアの睡眠分析で1件ずつ消してください。
              </p>
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
