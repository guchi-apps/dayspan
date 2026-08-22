# 通知（Web Push）の設定と確認

予定の前とタスクの期限に知らせる機能（docs/spec.md §32）の、鍵の作り方と動作確認の手順。

- 経緯: guchi-apps/dayspan#345
- 実装: `src/lib/web-push/`（送信）・`src/services/notifications/`（下書き・送信・設定）・`public/sw.js`（受け取り）
- 依存パッケージは追加していない。VAPIDの署名（RFC 8292）とペイロードの暗号化（RFC 8291）は `node:crypto` で行う

## 鍵（VAPID）

送信には3つの環境変数が要る。**未設定でも他の機能は動く**（通知だけが使えない）。

| 変数 | 内容 |
| --- | --- |
| `VAPID_PUBLIC_KEY` | ブラウザの `subscribe()` へ渡す公開鍵。65バイトの非圧縮点をbase64urlにした1行 |
| `VAPID_PRIVATE_KEY` | 署名に使う秘密鍵。32バイトをbase64urlにした1行 |
| `VAPID_SUBJECT` | 送信先が見る連絡先。`mailto:` か `https://` で始める |

PEMではなく1行のbase64urlで持つ。PEMを環境変数へ入れると改行が `\n` の文字列になり、
復元し損ねたときに「鍵が途中で切れている」形の失敗になる（signalyが踏んでいる）。

### 作る

```bash
node scripts/gen-vapid-keys.mjs mailto:自分のメールアドレス
```

出力の3行を、ローカルは `.env.local` へ、本番は1Password（`apps/dayspan` の
`vapid-public-key` / `vapid-private-key` / `vapid-subject`）へ入れる。

**鍵を作り直すと、それまでに登録された端末には届かなくなる。** 購読はブラウザ側が公開鍵と
結び付けて作るため、設定画面で登録し直してもらう必要がある。

### 本番へ配る

1Passwordが正で、GitHub Secretsへは `scripts/sync-github-secrets.sh` で同期する
（`.github/secrets-manifest.tsv` に対応表がある）。

```bash
scripts/sync-github-secrets.sh --only VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY,VAPID_SUBJECT
```

同期したあとデプロイすると、`.github/workflows/deploy.yml` の `update_env` が本番の `.env` へ書く。

### 公開鍵と秘密鍵の食い違い

別々の環境変数にあるため、片方だけ入れ替わっていても値としては読める。その状態では
**購読は作れるのに配信だけが落ち続け、画面には何も出ない。**

`src/lib/web-push/keys.ts` は秘密鍵から公開鍵を計算し直して突き合わせ、食い違っていれば
読み込みの時点で断る（設定画面では「鍵が未設定」と同じ扱いになる）。

> JWKで `x`・`y` を渡す形では、Nodeはその値が `d` と対になっているかを確かめずに受け取る。
> 書かれている値どうしを比べても食い違いは見つからないため、`createECDH` で計算し直している。

## 送信の中身を確かめる（ブラウザ不要）

```bash
node --experimental-strip-types scripts/check-web-push.mjs
```

RFC 8291 §5 に載っている「鍵・salt・平文・出来上がりのボディ」をそのまま通し、1バイトでも違えば
落ちる。VAPIDの署名も、その場で作った鍵で署名して同じ鍵で検証する。

実機で通知が出ないときは、まずこれを実行する。通れば**送信の中身は正しい**ため、原因は
端末側（ホーム画面に追加していない・通知を許可していない・購読が失効している）に絞れる。

## iPhoneでの確認

1. Safariで本番のDaySpanを開き、共有ボタンから「ホーム画面に追加」
2. **追加したアイコンから開く**（Safariのタブのままでは、iOSが通知の許可を出せない）
3. 設定 → 通知 → 「この端末で受け取る」を入れる。iOSの許可ダイアログで「許可」
4. 「テスト通知」を送る。数秒で1通届き、アイコンにバッジ（期限が今日以前のタスクの件数）が付く

出ないときの切り分け:

| 症状 | 見るところ |
| --- | --- |
| スイッチが押せない | ホーム画面のアイコンから開いているか。画面上部に理由が出る |
| 許可したのに届かない | `scripts/check-web-push.mjs`、次に本番の `.env` の3つの値 |
| 一度は届いたが止まった | 購読が失効している可能性。スイッチを入れ直す（失効した登録はサーバー側で自動的に消える） |
| バッジだけ出ない | iOSの「設定 > 通知 > DaySpan > バッジ」。通知を許可していてもバッジだけ切れる |

## 送信を手で走らせる

通常はアプリ内のタイマー（`src/instrumentation.ts`）が毎分呼ぶ。手で1回ぶん走らせるには、
サーバー間参照用APIの共有シークレット（docs/internal-api.md）を使う。

```bash
curl -s -X POST -H "Authorization: Bearer $INTERNAL_API_KEY" \
  "http://127.0.0.1:3113/api/internal/notifications/dispatch"
```

二重に走っても、送信済みの印を送る前に立てているため同じ通知は2回送られない。

## 開発環境での制限

- Service Workerは本番ビルドでのみ登録する（`src/components/offline/service-worker.tsx`）。
  `pnpm dev` では購読を作れず、設定画面のスイッチは理由を出して止まる
- ローカルで最後まで試すなら `pnpm build && pnpm start` で動かし、HTTPSで到達できるホスト名から開く
