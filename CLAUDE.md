# DaySpan 固有ルール

このリポジトリで作業する Claude Code エージェント向けの DaySpan 固有ルールを記載する。

共通の開発標準・運用知識は `m-guchi/docs` を一次情報源とし、このファイルには DaySpan 固有事項のみを置く。

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
| `html` / `body` に `overscroll-behavior: none` を指定する | スクロール可能領域が無い・端に達した状態でモバイルブラウザがページ全体をラバーバンドさせ、ヘッダー・フッターが指に追従してずれて見えるため。スクロール自体は妨げないため、内部スクロール領域や `settings` 配下のページスクロールとも両立する |

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
3. `.shared-context/CLAUDE.md` または `m-guchi/docs/CLAUDE.md`
4. 必要な `agent-rules/`、`knowledge/`、`standards/`、`guides/`
5. VPSの現在構成が必要な場合は `m-guchi/vps`

認証、OAuth、DBスキーマ、Secrets、本番環境設定などの変更では、共通ルールに従って必要なユーザー確認を行うこと。

---

# Issueごとの複数Claude Codeエージェント運用

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成〜レビュー〜マージまでをGitHub Actions上で
無人実行する運用を導入している。仕組みの本体は `m-guchi/issue-deck` にあり、DaySpanはその
再利用可能ワークフロー（`workflows/v6` タグ）を参照する側として構成している。

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

## Issueラベルの状態遷移

原則として以下の順で遷移する。`01.planning` は `21.plan-required` が付いている場合のみ経由する。

1. `01.planning` — 計画を検討中
2. `02.wip` — 実装中
3. `03.d:marge` — developへPR作成・マージ待ち
4. `05.develop` — developへマージ完了（main未反映）
5. `07.m:marge` — mainへのPR作成・マージ待ち
6. `09.main` — mainへマージ完了。**この時点でissueをclose**する

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

ラベルの付け替えはエージェント側でも手動で行うが、`.github/workflows/issue-labels.yml` が
ブランチpush・PR作成・PRマージをトリガーに同じ遷移を安全網として自動でも行う。

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
| `issue-labels.yml` | 参照（`@workflows/v6`） | ラベル状態遷移の自動化 |
| `claude-issue-dispatch.yml` | 参照（`@workflows/v6`） | `@claude` 起点の計画・実装・PR作成 |
| `claude-review-develop.yml` | コピー | develop向けPRの自動レビュー・リスク判定・Auto-merge |
| `claude-conflict-resolve.yml` | コピー | developとのコンフリクト自動解消 |
| `claude-ci-fix.yml` | コピー | CI失敗の自動修正 |
| `release-develop-to-main.yml` | コピー | バージョンbump PR・develop→mainのリリースPR作成 |

参照方式は `uses:` のタグを上げるだけでissue-deck側の改善が反映される。**`claude-issue-dispatch.yml` は
`uses:` のタグと `prompts-ref` を必ず同じ値にする**（片方だけ上げると新しいワークフローで古い
プロンプトが動く）。コピー方式は移植元コミットを各ファイル冒頭のコメントに記録しており、
issue-deck側の改善を取り込む際はそこを更新する。

`release-develop-to-main.yml` が生成する利用者向けの更新履歴は、`package.json` の `"version"`
ライフサイクルスクリプト経由で `scripts/update-changelog.mjs` が `src/lib/changelog.ts` へ追記する。
文面のルールは changelog-ja スキルに従う。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
