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

## 開発ルール

このリポジトリ固有のルールは [CLAUDE.md](CLAUDE.md) を参照してください。
共通の開発標準・運用知識は `m-guchi/docs` を一次情報源とします。
