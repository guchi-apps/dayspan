# セットアップチェックリスト（人手作業）

DaySpan を動かすために必要な、リポジトリ外の設定作業をまとめる。エージェントは 1Password・Google Cloud Console・Supabase・Notion・VPS・DNS・GitHub の Web 画面を操作できないため、以下はユーザーが実施する。

共通の手順は [m-guchi/docs](https://github.com/m-guchi/docs) の `guides/new-app-checklist.md` を一次情報源とし、ここには DaySpan 固有の値と、通常のチェックリストに無い項目だけを書く。

## 1. 1Password（`apps` ボールト / `dayspan` アイテム）

| フィールド | 値 |
|---|---|
| `target-dir` | VPS上の配置先（例: `/apps/dayspan`） |
| `port` | `3113` |
| `db-name` | `app_dayspan` |
| `allowed-google-emails` | 利用を許可するGoogleアカウント（カンマ区切り） |
| `token-encryption-key` | `openssl rand -base64 32` で生成した32byte鍵 |
| `google-calendar-client-id` | 本番用のDaySpan専用OAuthクライアントID |
| `google-calendar-client-secret` | 同シークレット |
| `internal-api-key` | サーバー間参照用APIの共有シークレット（`openssl rand -hex 32` で生成。呼び出し元のAIDE側にも同じ値を設定する。docs/internal-api.md） |
| `ci-webhook-url` | Signaly の DaySpan 用チャンネルWebhook URL |
| `vapid-public-key` | 通知（Web Push）の公開鍵。`node scripts/gen-vapid-keys.mjs mailto:自分のアドレス` の出力（docs/notifications.md） |
| `vapid-private-key` | 同・秘密鍵。上のコマンドが公開鍵と対で出す |
| `vapid-subject` | 同・連絡先。`mailto:` か `https://` で始める |

`TRAINROUTE_TOKEN`（電車の所要時間を trainroute 経由で引くための共有シークレット。docs/spec.md §29）は
**`dayspan` アイテムには置かない。正は `op://apps/trainroute/internal-api-key`** で、trainroute が
受ける側として持っている値をそのまま参照する。**両側が同じ値でないと 401 で連携が止まる。**
このとき画面はエラーにならず、電車の所要時間だけがAIの見積もりへ静かに落ちるため、
止まっていることに気付きにくい。値を更新するときは trainroute とDaySpanの両方を同時に同期する。
未設定の間は、設定 ▸ 移動 の「経路検索の利用状況」も出ない（出す数字が無いため。docs/spec.md §29）。


共通アイテム（`DB` / `Server` / `githubaction-sshkey` / `Supabase`）は既存のものをそのまま参照する（`.github/deploy.env.tpl` 参照）。

機械可読の正は `.github/secrets-manifest.tsv` で、この表はその人手作業ぶんを日本語で並べたもの。
1Passwordへ入れたあとは、GitHub Secretsへの同期まで行って初めて本番へ届く。

```bash
gh workflow run sync-secrets.yml -f only=VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY,VAPID_SUBJECT,TRAINROUTE_TOKEN
```

（手元から `scripts/sync-github-secrets.sh` を叩く場合は個人アカウントのセッションが要る。
サービスアカウントのトークンが環境変数にあると `op` の書き込みだけが全部失敗する。）

**同期しないとデプロイは空の値をそのまま本番の `.env` へ書き、その機能だけが黙って使えないまま残る。**
実際に `vapid-*` の3つが登録されないまま、設定画面に「鍵が設定されていません」と出続けていた（#359）。
これを見つけるために、デプロイのたびに `secrets-check` ジョブがマニフェストの `repo` 項目と
突き合わせ、空のものがあればSignalyへ知らせる。

同期したあとは `gh secret list` に並んだことを確かめる。**ここまでやって初めて済んだことになる。**

**マニフェストへ `repo` 項目を足す変更は、同期まで済ませてからマージする。** CI（`ci.yml` の
`secrets-check`）が develop 向けのPR・pushで同じ突き合わせを行い、届いていない値があれば
**ジョブを落とす**。deploy側（`deploy.yml`）は warning を出すだけでデプロイを続けるため、
デプロイが緑であることは登録できた根拠にならない（#400 では #359 と同じ状態が気付かれずに残り、
同じ症状が再び報告された。#476 の `TRAINROUTE_TOKEN` も、1Passwordには入っているのに
同期されないままリリースをまたいでいた）。deploy側を落とさないのは、VAPID鍵のように
無くても他の機能は動く値が含まれるため。**気付ける場所をマージ前へ移すのがCI側の役割。**

## 2. Supabase（他アプリと共有のプロジェクト）

- Authentication > URL Configuration > Redirect URLs に以下を追加する
  - `https://dayspan.gucchii.com/auth/callback`
  - `http://localhost:3000/auth/callback`（ローカル開発用）
  - 実機確認をする場合は `http://<LAN IP>.sslip.io:3000/auth/callback`
- Google プロバイダは既に有効化済みのものを使う。**カレンダーのスコープはここに追加しない**（他アプリのログインに影響するため。下記3で別クライアントを用意する）

## 3. Google Cloud Console（DaySpan専用のOAuthクライアント）

Google Calendar API 用に、ログイン用とは別の OAuth 2.0 クライアントを本番用・開発用の2つ作成する。

- Google Calendar API を有効化する
- スコープは `https://www.googleapis.com/auth/calendar.events` と `https://www.googleapis.com/auth/calendar.readonly` に限定する（必要以上に広い権限を要求しない。仕様 §17）
- 承認済みリダイレクトURI
  - 本番: `https://dayspan.gucchii.com/api/google/callback`
  - 開発: `http://localhost:3000/api/google/callback`
- 本番用の認証情報のみ 1Password に登録し、開発用は `.env.local` に直接記載する

## 4. Notion

- Notion側に DaySpan 用のタスクDBを用意する（DaySpanからは作成しない。仕様 §9）
- Internal Integration を作成し、そのタスクDBに接続を許可する
- 発行された Integration Token は、DaySpanの設定画面から入力する（1Password・環境変数には置かない。ユーザーごとにDBへ暗号化保存する）

必要なプロパティ構成（名前は接続時にDaySpan側でマッピングする）:

| 用途 | Notionのプロパティ型 |
|---|---|
| タイトル | title |
| 期限 | date（時刻あり / 日付のみ / 未設定を許容） |
| 完了状態 | checkbox または status |
| メモ | rich_text |
| 優先度 | select（高 / 中 / 低） |
| 繰り返し | select（なし / 毎日 / 毎週 / 毎月 / 毎年） |
| タグ | multi_select |

## 5. データベース（VPS）

```sql
CREATE DATABASE app_dayspan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

アプリ用ユーザー・マイグレーション用ユーザーへの権限付与は既存アプリと同じ方針（共通 `DB` アイテムのユーザーを利用）。

## 6. GitHub

- デフォルトブランチを `develop` に変更する
- `main` の Branch protection を設定する（CI必須チェック + PR経由のみ）
- リポジトリ Secrets に `OP_SERVICE_ACCOUNT_TOKEN` を追加する
- Issueラベルを `m-guchi/docs` の `label-sync/` から同期する

## 7. VPS

- `/apps/dayspan/` を作成する
- Apache VirtualHost を追加する（`dayspan.gucchii.com` → `127.0.0.1:3113`）。DNS登録・Let's Encrypt証明書の取得を含む
- 本番プロセスを追加する前に、実機のメモリ余力を確認する（VPSは約2GB。仕様 §24）

## 8. 一覧への登録

- [m-guchi/vps](https://github.com/m-guchi/vps#アプリ一覧) の README のアプリ一覧に DaySpan を追加する
- `m-guchi/docs` の `standards/tech-stack.md` のスタック一覧に追加する
