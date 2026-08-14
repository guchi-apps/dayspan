# DaySpan 固有ルール

このリポジトリで作業する Claude Code エージェント向けの DaySpan 固有ルールを記載する。

共通の開発標準・運用知識は `guchi-apps/docs` を一次情報源とし、このファイルには DaySpan 固有事項のみを置く。

## このリポジトリの構成（エージェント向けの前提）

| 項目 | 内容 |
|---|---|
| フレームワーク | Next.js 16（App Router）/ React 19 / TypeScript 5 |
| スタイリング | Tailwind CSS v4 + shadcn/ui（`components.json` の style は `radix-nova`） |
| ORM / DB | Prisma 6 + MariaDB（`app_dayspan`） |
| 認証 | Supabase Auth + Google OAuth（`@supabase/ssr`。ミドルウェアは `src/proxy.ts`） |
| パッケージマネージャ | pnpm 10 系（`packageManager` で固定） |
| 検証コマンド | `pnpm lint` / `pnpm typecheck` / `pnpm build`（`pnpm test` は lint + typecheck） |
| 開発サーバー | `pnpm dev`（既定ポート3000。`PORT` で変更可） |
| デプロイ | `main` への push で `deploy.yml` が VPS へ SSH デプロイ（PM2、プロセス名 `dayspan`、ポート3113） |

Prisma は 7 系ではなく **6 系** を使う。7 系は driver adapter が必須になり、他アプリ（issue-deck 等）の構成から外れるため。

## アプリ概要

DaySpan は、Google Calendar の予定と Notion のタスクを同じカレンダーUI上で統合して確認・操作するWebアプリ。

詳細仕様は `docs/spec.md` を一次情報源とする。

## データの一次情報源

- Google Calendar の予定本体: Google Calendar
- タスク本体: Notion
- DaySpan 固有設定・連携メタデータ: DaySpan の MariaDB

Google Calendar の予定本体および Notion タスク本体を、DaySpan DBへ恒久的に二重保存しない。

## 認証

- Supabase Auth + Google OAuth を使用する。
- NextAuth / Auth.js は使用しない。
- 初期リリースは許可されたユーザーのみ利用可能とする。
- 将来の一般公開を前提に、ユーザー単位で外部サービス連携を管理できる構造にする。

## 外部連携

- Google Calendar API: 複数カレンダーの取得、予定の作成・編集・削除
- Notion API: タスクDBとの同期、タスクの作成・編集・完了

UIコンポーネントから外部APIを直接操作する構造を避け、将来API/MCPから再利用できるサービス層を介する。

## 実装上の決定（変更する前に理由を確認すること）

コードのコメントにも書いているが、判断の理由が分かれていると再発しやすいものをここに集約する。

| 決定 | 理由 |
|---|---|
| Prisma は 6 系を使う | 7 系は `datasource url` が廃止され driver adapter が必須。他アプリの構成から外れる |
| Notion は `taskDataSourceId` を一次キーにする | API 2025-09-03 以降、プロパティとクエリの対象はデータベースではなくデータソース |
| 日付・時刻の解釈は `UiSetting.timeZone` で固定する | 実行環境のローカル時刻に依存させると、サーバー（UTC）とブラウザ（JST）で描画がずれてハイドレーションが一致しない |
| ログイン開始はサーバー側で行う（`/auth/signin`） | クライアントJSのハイドレーション前でもログインできる必要があるため |
| 予定の文字色は背景の明るさから選ぶ | Google のパレットには淡い色があり、白固定では読めない。白で3.0を確保できる色だけ白のままにする |
| 日をまたぐ予定はドラッグ対象外 | 複数日表示でどちらの日を動かしているか決まらないため |
| 月表示はスクロールを契機に読み込み直さない | 再描画で開いていたダイアログが閉じ、操作を受け付けていないように見えるため |
| 繰り返しの曜日指定は `毎週(月・水・金)` の形で保存 | Notion の select プロパティ1つで表現する必要があるため |
| 日表示は前後1期間ぶんまで先に取得する | 左右スワイプが指に追従して隣の期間を見せるため。表示中の期間だけだと動かした先が空欄になる |
| 時間グリッドに並べる日は楽観的な anchor から決める | 前へ・次へ・スワイプで、取得の完了を待たずに隣の期間へ切り替わる必要があるため |
| 横スワイプは縦との勝敗が決まるまで日付を動かさない | 縦スクロール・予定のドラッグと同じ面の上の操作で、取り違えるとスクロールのつもりで日付が変わるため |
| 日時の入力は日付と時刻の欄に分ける | `datetime-local` 1つだとスマートフォンで日付から順に選ばされ、時刻だけを直せないため |
| スワイプは期間ではなく1日ずつ動かす | 3日表示で3日ずつしか動けないと、今日を真ん中に置くような見方に切り替えられないため。前へ・次へは従来どおり期間ごと |
| カレンダーの空きを押したら簡易入力を出す | 日時は押した位置で決まっており、全項目を出すと直す欄より埋まっている欄が多くなるため |
| 長押しを受けるのは指・ペンのみ | マウスには押し続ける操作が無く、少し長めのクリックを追加と取り違えると、移動したいだけの操作が入力欄になるため |
| ダイアログの位置は className ではなく `position` で選ぶ | 位置・角丸・出方が組で決まる。上書きにすると基底の角丸や拡大の指定が残って打ち消し合うため |
| Service Worker は自前で書く（next-pwa / Serwist を使わない） | 保存してよいものをこちらで列挙できるほうが、認証付きのページや書き込みAPIを取り違えて保存する事故を防ぎやすい。新規依存も増やさずに済む |
| RSC（ソフトナビゲーション）の応答はキャッシュしない | 中身が `Next-Router-State-Tree` や先読みかどうかで変わり、別の状況で再生すると描画が壊れるため |
| オフライン判定は `navigator.onLine` ではなく `next/offline` の `useOffline` | `navigator.onLine` はOSのネットワーク接続しか見ず、WiFiには繋がっているが外へ出られない状態を `true` と答えるため |
| `sw.js` は `src/proxy.ts` の matcher から除外する | 未ログインだと `/login` へのリダイレクトがHTMLで返り、MIMEタイプ違いで Service Worker の更新が失敗するため |
| 毎年の日付リマインドはサーバー側で年ごとに展開し、IDへ日付を足す | 登録した年が表示範囲の外にあるため日付では絞り込めず、毎年の項目だけ別に取って展開する必要がある。IDが同じままだと、月ごとに保持するときに同じ項目として1件に潰れるため |
| 追加は種類を選ばせず入力画面を直接開く | 押す前に決めさせると、入力の途中で作りたいものが違うと気付いたときに、閉じて選び直すことになるため。予定・タスク・日付リマインドは1つのダイアログの中で切り替える |
| 入力ダイアログの枠は `ItemDialog` が持ち、中身だけ差し替える | Radixのダイアログを開いたままアンマウントすると `<body>` の `pointer-events: none` が残り、画面全体が操作を受け付けなくなることがあるため |
| 毎年の日付リマインドの編集は `sourceDate` を初期値にする | カレンダーに出ているのは展開した年の日付。そのまま保存すると毎年の起点そのものが動いてしまうため |
| ピンチ中の2本指スクロールは自前で動かす | 倍率を変えるには `touchmove` の既定動作を止めるしかなく、止めるとブラウザのスクロールも一緒に止まる。指を動かしても画面が固まって見えるため、掴んだ時刻を指の下へ留める計算の中で `scrollTop` も合わせる |
| 時間グリッドの位置は分で持ち、px はその都度求める | 1時間あたりの高さがピンチで変わるため。位置を px で持ち回ると、倍率を変えるたびに全ての値を作り直すことになる。重なり判定だけは既定の倍率で固定し、拡大しただけで予定の列の並びが変わらないようにする |
| タグ・種類の選択肢はNotion側を一次情報源にする | 選択肢と色はNotionのプロパティ定義そのもの。DaySpanへ写すとNotionで直接タグを付けた分と食い違う。DaySpanからできるのは追加と削除だけで、既存の選択肢の名前・色はNotion APIが変更を受け付けない（色は `Cannot update color of select with id: ...`、名前は無視される）。作り直せば変えられるが、選択肢を消すとそれが付いていた既存ページからも外れる |
| タグは文字入力ではなくチップから選ばせる | カンマ区切りの自由入力だと、同じつもりの名前が「仕事」「しごと」のように増えていくため。ただし入力画面から新しい名前も足せるようにする。閉じて設定画面へ回らせないため |
| タグの取得は予定・タスクの取得と分ける | 選択肢は月をまたいでも変わらない。カレンダーの取得に混ぜると、月を送るたびにNotionへの往復が増えるため |
| 場所の候補はNotionの場所DBを一次情報源にする | 予定・タスクと同じく、利用者が手で直せる場所に本体を置く。過去の予定から拾うと、直近の取得範囲に無い場所が候補から漏れる |
| AIに場所を尋ねるのは候補0件のときのボタン操作だけ | 呼ぶたびに利用枠を消費する。入力のたびに自動で呼ぶと、打っている途中の文字列で何度も呼ばれる |
| 場所は入力画面からその場で登録できる | 入力の途中で思いついた場所を使うために、設定画面やNotionへ回らせないため。タスクのタグを入力画面から足せるようにしているのと同じ理由 |
| AIの提案を場所DBへ登録するかは選ばせる | 一度きりの場所まで自動で登録すると、次からの候補が使わない場所で埋まるため |
| 場所の候補は入力欄の下へ押し出して出す | ダイアログの中に重ねると、スクロール領域の端で隠れてどこまで候補があるか分からなくなるため |
| `html` / `body` に `overscroll-behavior: none` を指定する | スクロール可能領域が無い・端に達した状態でモバイルブラウザがページ全体をラバーバンドさせ、ヘッダー・フッターが指に追従してずれて見えるため。スクロール自体は妨げないため、内部スクロール領域や `settings` 配下のページスクロールとも両立する |
| 繰り返しの `UNTIL` は終日なら日付、時刻ありならUTCの日時にする | RFC 5545 では `DTSTART` の型と揃っている必要がある。ずれているとGoogleが繰り返しを作らないため。選んだ日の分まで繰り返したいので、時刻ありではその日の終わりを設定タイムゾーンからUTCへ直す |
| 繰り返しの間隔は「何週間ごと」のように入力欄のラベルへ単位を含める | 単位が頻度で変わる。欄の外に単位を並べると、スマートフォンで数字の欄が狭くなるため |
| 毎週の曜日は開始日の曜日を初期値にし、選び直したあとは開始日を変えても動かさない | 複数選択の欄が空のまま現れると何も繰り返さないように見える。一方で、指定した曜日が開始日の変更で黙って書き換わると、選んだつもりの曜日と実際が食い違うため |
| 削除は必ず確認を挟む | 押し間違えても画面上に戻す手立てが無い。繰り返し予定では1回分のつもりがシリーズ全体に及びうる。戻せるかどうかも保存先で違う（Googleの予定は戻せない、Notionはゴミ箱から戻せる）ため、実行前に示す |
| 削除は表示画面からも行える | 消すためだけに編集画面を開かせないため。編集画面にしか置かないと、消したい項目を開いて編集に切り替えるまで削除にたどり着けない |
| 繰り返しの「これ以降」は親のRRULEへUNTILを入れる | 画面に出ているのは `singleEvents` で展開した1回分で、そのIDを消してもその回しか消えない。境目は動かした先ではなく `originalStartTime` にする。動かした先を基準にすると、まだ消したくない回まで範囲に入るため |
| 予定日は期限とは別の枠として両方カレンダーに出す | 期限は締切、予定日はその辺りで片付けるつもりだという見込みで意味が違う。どちらか一方に寄せると、締切が見えないか、いつやるつもりかが見えないかのどちらかになる。同じタスクだと分かるよう形は変えず、予定日側だけ破線にする |
| 予定日と期限が同じ日時なら期限の1枠にまとめる | 同じ場所に同じタイトルが2つ並ぶだけで、読める情報が増えないため。日が同じで時刻が違う場合は位置が別になるので分ける |
| カレンダー上のタスクは `タスクID:期限/予定日` で識別する | 1つのタスクが2枠に現れるため、IDだけではどちらを掴んでいるのか・どちらのキーなのかが決まらない。掴んだ枠の日付だけを動かすのにも要る |
| タスク一覧の分類・並び順は期限のままにする | 2つの日付で分類すると、同じタスクがどちらの区分に入るのか読めなくなるため。予定日は各行に添えるだけにする |
| カレンダー上の日付リマインドの印は菱形にする | ベルのアイコンは輪郭を読ませるために大きさが要り、9〜10pxの枠では項目名の幅をその分奪う。形だけで見分けられればよいので、タスクの縦棒と向きで分かれる菱形に置き換えた |
| 枠に添える補助ラベルは項目名と同じ文字列として流す | 別の要素にして縮まないようにすると、枠が狭いときに削られるのが項目名の側になり、年目や時刻だけが残って何の項目か読めなくなる。1つの文字列にすれば末尾から切れる |
| 空き時間の範囲選択はマウス・ペンだけで受ける | 指では同じ面の上で縦スクロールが起きるため、空きをなぞる操作と区別できない。押して簡易入力を開く従来の動作はどの入力機器でも残す |
| 範囲選択の列は押した日から動かさない | 縦に引く操作で横のぶれは避けられない。動かした先の列で作ると、斜めに引いただけで別の日の予定になる。日をまたぐ予定はこの操作では作らない |
| 範囲選択の枠は破線＋流れる縞にする | 保存前だと分かる必要がある。止まった枠だと、すでに置かれた予定と見分けが付かない。縞が流れ続けることで「いま押さえているところ」だと伝わる |
| ドラッグ直後のclickの打ち消しは全ての印を確かめる | どれか1つが立った時点で打ち切ると、確かめなかった側の「動かした」印が残り、次に普通に押したときのclickがそちらに食われる |
| 経過日数は過去の日付にだけ出し、登録した日から数える | 日付リマインドには誕生日・記念日のように過ぎた日付と、契約更新・有効期限のようにこれから来る日付が混ざっている。前者にしか「何日経ったか」は当てはまらない。数え始めを表示中の年にすると、毎年の項目で誕生日からの日数が毎年振り出しに戻るため `sourceDate` から数える。日付キーは `slice` ではなく `itemDateKey` で求める（時刻ありの項目はUTC表記だと日付が1日ずれる） |
| M3のカラーロールは `--color-<ロール>` まで `@theme` に出す | `--color-tertiary-container` だけを書いて `--color-tertiary` を出さないと、Tailwind v4 は `bg-tertiary` を未定義のユーティリティとして黙って捨てる。エラーにならず色が付かないだけなので、目盛りや細い線が消えていても気付きにくい |

## デプロイ

pnpm は 11 系ではなく **10 系** に固定する。VPS の Node.js が 20 系で、pnpm 11 は Node 22.13 以上を
要求する（`node:sqlite` を使うため起動できない）。他アプリと同じ `pnpm@10.34.5` に揃えている。

`deploy.yml` は成果物を `tar` で固める際に `public` を含める。静的ファイルを置いていなくても
ディレクトリ自体が存在しないと `tar` が失敗するため、`public/.gitkeep` を追跡対象に残している。

## 外部APIの扱い

- Google Calendar / Notion への呼び出しは `src/services/` を経由し、UIコンポーネントから直接叩かない（`docs/spec.md` §22）。
- 外部APIの失敗を握りつぶさない。`src/lib/api-error.ts` を使い、サーバーログへ全文を残し、画面には外部APIが返したメッセージを表示する。原因が分からないまま「保存できませんでした」だけが出る状態にしない。

## MVP対象外

- 検索
- Push通知 / 期限通知
- MCPサーバー
- リアルタイム同期
- オフライン書き込みと再接続後の同期キュー

## 実装時の参照順

1. この `CLAUDE.md`
2. `docs/spec.md`
3. `.shared-context/CLAUDE.md` または `guchi-apps/docs/CLAUDE.md`
4. 必要な `agent-rules/`、`knowledge/`、`standards/`、`guides/`
5. VPSの現在構成が必要な場合は `guchi-apps/vps`

認証、OAuth、DBスキーマ、Secrets、本番環境設定などの変更では、共通ルールに従って必要なユーザー確認を行うこと。

---

# Issueごとの複数Claude Codeエージェント運用

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成〜レビュー〜マージまでをGitHub Actions上で
無人実行する運用を導入している。仕組みの本体は `guchi-apps/issue-deck` にあり、DaySpanはその
再利用可能ワークフロー（`workflows/v9` タグ）を参照する側として構成している。

設計の詳細・各モードの判定ロジックは issue-deck の `docs/multi-agent-workflow.md`・`docs/multi-agent/` を
一次情報源とする。ここにはDaySpan側の運用に必要な事項のみを置く。

## ブランチ運用

- `main` は本番と一致するリリース用ブランチ。直接pushは禁止し、`develop` → `main` のPRのみで進める
- `develop` が日常の開発ブランチ
- Issue専用ブランチは `develop` から作成し、ブランチ名は `issue-<Issue番号>` とする（例: `issue-12`）。
  ラベル遷移・レビュー・コンフリクト解消の各ワークフローはこの命名規約からIssue番号を特定するため、
  従わないブランチはすべて対象外になる
- worktreeは本体リポジトリの外（`~/apps/dayspan-worktrees/<ブランチ名>/`）に作成する。
  本体 `~/apps/dayspan` は `develop` の最新チェックアウトとして空けておく
- 開発サーバーのポートは `scripts/start-issue.sh` が `.env.local` に `PORT=6000 + Issue番号` を設定する
  （例: issue-12 → 6012）。issue-deck（`4000 + Issue番号`）や本番ポート3113・dev既定の3000と重ならない

## Issueの進捗

**進捗はGitHub ProjectsのStatusで管理する。唯一の正はStatusで、進捗ラベルは存在しない**
（guchi-apps/issue-deck#1010 / #991 Phase 5 で `01.planning`〜`09.main` を廃止した）。

原則として以下の順で遷移する。`Planning` は `21.plan-required` が付いている場合のみ経由する。

1. `Ready` — 未着手
2. `Planning` — 計画を検討中
3. `Implementation` — 実装中
4. `Develop PR` — developへPR作成・マージ中
5. `Develop` — developへマージ完了（main未反映）
6. `Release` — mainへのPR作成・マージ中
7. `Done` — mainへマージ完了。**この時点でissueをclose**する

**`gh issue edit` で進捗を進めることはできない。** Statusを書けるのはissue-deckだけで、
ワークフローは進捗報告API（`POST /api/progress`）へ報告する。ブランチのpush・PR作成・PRマージを
トリガーに自動で遷移するため、**エージェントが自分で進捗を動かす必要はない。**
人が動かす場合はissue-deckのカンバンでカードをドラッグするか、画面のボタンを使う。

`00.check-user`（ユーザーの確認・指示が必要）は、上記のどの段階でも他のラベルと併用して付与する。
`00.check-user` を人間が外す操作が「承認」を意味する。

オプション制御のラベル:

| ラベル | 効果 |
|---|---|
| `21.plan-required` | 実装前に計画を提示し、承認を得てから実装に入る |
| `22.merge-confirm-required` | 内容によらず、developへのマージ前に必ず `00.check-user` を付ける |
| `23.preview-required` | PR作成前に開発サーバーの画面で確認し、承認を得る |
| `24.screenshot-required` | PR作成前にスクリーンショットで確認し、承認を得る。**無人実行では現状使えない**（全画面がSupabase Auth + Google OAuthの背後にあり、CIログインバイパスもPlaywright依存も無いため） |
| `11.local` | 付いている間、無人実行ワークフローが計画・実装・分割・追加対応を行わない。ローカルのClaude Codeセッションと二重に進めないための停止フラグ |

進捗の報告は `.github/workflows/issue-labels.yml` が、ブランチpush・PR作成・PRマージを
トリガーに自動で行う。**エージェントが手動で行う作業は無い。**

## 自動マージ不可カテゴリ

以下に該当する変更は、レビュー・統合エージェントが自動マージせず `00.check-user` を付与して
ユーザーの確認を待つ。`claude-review-develop.yml` の `risk-check` ジョブがパスパターンで一次判定し、
パターンに掛からない意味的なリスクはレビューエージェントが二次判定する。

- 認証・認可（`src/proxy.ts`、`src/lib/supabase/**`、`src/app/auth/**`、`src/lib/crypto/**`）
- DBスキーマ変更・マイグレーション（`prisma/migrations/**`）
- 本番環境の設定（`deploy/**`、`**/*.env.tpl`）
- GitHub Actionsやデプロイ設定（`.github/workflows/**`）
- Secretsや環境変数（`.env*`）
- 課金・決済
- 大規模な依存関係の更新（`package.json` のメジャーバージョン更新）
- `develop` → `main` のマージ

無人実行では確認する相手がその場にいないため、**新しい依存関係の追加が必要になった場合は追加せず**、
`00.check-user` を付与して停止する（依存追加はユーザー確認が必須のため）。シークレットの実値も
コミット・コメントのいずれにも書かない。

## 実装エージェントの禁止事項

- `main` / `develop` への直接コミット・push
- 他Issueのブランチ・worktreeの編集
- 不要なforce push
- 自分が作成したPull Requestの自己マージ
- 共有知識リポジトリ（`.shared-context/` / `~/apps/_docs`）の編集・コミット

レビュー・統合エージェントは、加えて `main` への直接マージ・pushを行わない。

## PR本文テンプレート

`develop` 宛のPRには以下を記載する。

- 対応Issue（`closes #番号` / `fixes #番号` は使わず `#番号` のみ。developマージ時点ではissueを
  closeしない運用のため）
- 実装内容
- テスト内容
- 確認方法（画面に関わる変更では `http://localhost:<6000 + Issue番号>` とアクセス手順）
- 注意点

## ローカルからの起動

```bash
scripts/start-issue.sh <issue番号> [issue番号...]
```

worktree作成・`.env.local` のコピー・ポート割り当て・`pnpm install`・開発サーバーの自動起動までを行い、
実装エージェント用のClaude Codeセッションを起動する（プロンプトは `scripts/prompts/implementation-agent.md`）。
Windows側からは `scripts/start-issue.ps1` を使う。

ローカルセッションで進めるIssueには `11.local` を付け、無人実行と二重に走らないようにする。

## ワークフローの構成

| ファイル | 方式 | 内容 |
|---|---|---|
| `issue-labels.yml` | 参照（`@workflows/v9`） | 進捗（Project Status）の報告 |
| `claude-issue-dispatch.yml` | 参照（`@workflows/v9`） | `@claude` 起点の計画・実装・PR作成 |
| `claude-review-develop.yml` | 参照（`@workflows/v9`） | develop向けPRの自動レビュー・リスク判定・Auto-merge |
| `claude-conflict-resolve.yml` | 参照（`@workflows/v9`） | developとのコンフリクト自動解消 |
| `claude-ci-fix.yml` | 参照（`@workflows/v9`） | CI失敗の自動修正 |
| `release-develop-to-main.yml` | コピー | バージョンbump PR・develop→mainのリリースPR作成 |

**参照しているタグは正ではない。** 上げたらこの表も直すが、実態は
`.github/workflows/` の `uses:` を見るのが確実。

参照方式は `uses:` のタグを上げるだけでissue-deck側の改善が反映される。**`claude-issue-dispatch.yml` は
`uses:` のタグと `prompts-ref` を必ず同じ値にする**（片方だけ上げると新しいワークフローで古い
プロンプトが動く）。コピー方式（`release-develop-to-main.yml` のみ）は移植元コミットをファイル冒頭のコメントに
記録しており、issue-deck側の改善を取り込む際はそこを更新する。

無人実行のたびに `.shared-context/`（共有知識）と `.shared-prompts/`（issue-deck側の
実装プロンプト）がワークツリーへcheckoutされる。**どちらもこのリポジトリの管理対象ではない。**
`.gitignore` 済みなので、**編集・`git add`・コミットを一切行わないこと。**

`release-develop-to-main.yml` が生成する利用者向けの更新履歴は、`package.json` の `"version"`
ライフサイクルスクリプト経由で `scripts/update-changelog.mjs` が `src/lib/changelog.ts` へ追記する。
文面のルールは changelog-ja スキルに従う。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->