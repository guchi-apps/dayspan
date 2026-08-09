# DaySpan

Google Calendar の予定と Notion のタスクを、1つのカレンダーUIで統合して確認・操作するWebアプリです。

## 概要

- Google Calendar の複数カレンダーを統合表示
- Google Calendar の予定を作成・編集・削除
- Notion をタスクの一次情報源として利用
- Notion タスクを作成・編集・完了・期限変更
- 月表示と、0:00〜24:00 の時間グリッド表示
- スマートフォンは月 / 1日表示、PCは月 / 3日 / 7日表示
- Supabase Auth + Google OAuth による認証
- PWA対応。オフライン時は取得済みデータの閲覧のみ可能

詳細仕様は [docs/spec.md](docs/spec.md) を参照してください。

## 構成

| 項目 | 内容 |
|---|---|
| フレームワーク | Next.js 16（App Router）/ React 19 / TypeScript |
| スタイリング | Tailwind CSS v4 + shadcn/ui |
| DB | MariaDB + Prisma（`app_dayspan`） |
| 認証 | Supabase Auth + Google OAuth（他アプリと共有のSupabaseプロジェクト） |
| 本番URL | `https://dayspan.gucchii.com` |
| 本番ポート | `3113`（PM2、プロセス名 `dayspan`） |

共通の開発標準・運用知識は [m-guchi/docs](https://github.com/m-guchi/docs) を一次情報源とします。

### データの一次情報源

予定本体は Google Calendar、タスク本体は Notion が一次情報源で、DaySpan の DB へは恒久的に保存しません。DaySpan の DB が保持するのは連携設定・表示設定・連携メタデータのみです（`prisma/schema.prisma`）。

### 認可の分離

ログイン用の Google OAuth（Supabase Auth 側、他アプリと共有）と、Google Calendar API 用の OAuth（DaySpan 専用クライアント）を分けています。共有 Supabase / Google Cloud プロジェクトの同意画面にカレンダーのセンシティブスコープを追加せずに済ませるためです。カレンダー連携は設定画面から個別に接続し、リフレッシュトークンは AES-256-GCM で暗号化して DaySpan の DB に保存します。

## ローカル開発

```bash
pnpm install
pnpm env:init        # .env.local.example を .env.local へコピー（初回のみ）
# .env.local を編集（DATABASE_URL / Supabase / 許可メール / 暗号鍵）
pnpm db:setup        # ローカルMariaDBにDB・ユーザーを作成
pnpm db:migrate:dev --name init
pnpm dev             # http://localhost:3000
```

暗号鍵は `openssl rand -base64 32` で生成します。

Googleログインを通すには、共有Supabaseプロジェクトの Redirect URLs に `http://localhost:3000/auth/callback` を登録し、`ALLOWED_GOOGLE_EMAILS` に自分のGoogleアカウントを設定しておく必要があります。

スマートフォン等の同一LAN上の別端末から確認する場合は、生のLAN IPではOAuthのリダイレクトが失敗します。`http://<IP>.sslip.io:3000` の形式でアクセスし、そのURLをSupabaseの Redirect URLs にも登録してください（`scripts/dev.sh` がWindows側のポートフォワーディングをベストエフォートで設定します）。

### 検証コマンド

```bash
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm test        # lint + typecheck
pnpm build       # 本番ビルド
```

## デプロイ

`main` への push で `.github/workflows/deploy.yml` が VPS へ SSH デプロイし、PM2（プロセス名 `dayspan`、ポート 3113）を再起動します。シークレットは 1Password（`op://apps/dayspan/...`）から GitHub Actions 実行時に注入します。

初回デプロイ前に必要な手作業は [docs/setup-checklist.md](docs/setup-checklist.md) を参照してください。

## 開発ルール

このリポジトリ固有のルールは [CLAUDE.md](CLAUDE.md) を参照してください。
共通の開発標準・運用知識は `m-guchi/docs` を一次情報源とします。
