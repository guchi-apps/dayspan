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
| パッケージマネージャ | pnpm |
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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
