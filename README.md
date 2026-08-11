# DaySpan

Google Calendar の予定、Notion のタスクと日付リマインドを、1つのカレンダーUIで統合して確認するWebアプリです。

## 概要

- Google Calendar の複数カレンダーを統合表示
- Google Calendar の予定を作成・編集・削除
- Notion をタスクの一次情報源として利用
- Notion タスクを作成・編集・完了・期限変更
- Notion の記念日・更新日など、完了を持たない日付リマインドを月カレンダーと専用一覧に表示
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

共通の開発標準・運用知識は [guchi-apps/docs](https://github.com/guchi-apps/docs) を一次情報源とします。

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

### スマートフォンからの確認

`pnpm dev` を実行すると、`scripts/setup-lan-access.sh` がWindows側のポートフォワーディングとファイアウォール許可を設定し（UACダイアログが出るので許可する）、アクセスURLを表示します。

```
LAN経由でのアクセスURL（同一LAN上の別端末から）:
  http://192.168.2.114.sslip.io:3000
Supabaseの Redirect URLs に未登録なら追加してください:
  http://192.168.2.114.sslip.io:3000/auth/callback
```

**生のLAN IPではGoogleログインが必ず失敗します。** Supabase Auth はホスト名がIPアドレスとして解釈できる場合、許可リストの照合より前にループバック以外を拒否するためです（設定では回避できない実装上の仕様）。`sslip.io` はDNSを引くとホスト名に含まれるIPをそのまま返すため、通信はLAN内で完結したままホスト名としてアクセスできます。

表示されたURLの `/auth/callback` をSupabaseの Redirect URLs に登録してからアクセスしてください。Windows側のLAN IPが変わった場合は、新しいURLの登録が必要です。

`next.config.ts` の `allowedDevOrigins` は `**.sslip.io` を指定しています。`*` は1ラベルにしか一致せず、`192.168.2.114.sslip.io` のようにIPがラベルとして並ぶホスト名には届きません。ここが一致しないと dev サーバーがJavaScriptチャンクをブロックし、画面は表示されるのにボタンが一切反応しない状態になります。

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
共通の開発標準・運用知識は `guchi-apps/docs` を一次情報源とします。