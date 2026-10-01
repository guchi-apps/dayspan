# YoteiFlow iOSアプリ

本番YoteiFlow（`https://dayspan.gucchii.com/`）をiPhoneのアプリとして開くための、SwiftUI + WKWebView の薄い殻です（#908）。
**画面と機能はすべてWeb版が正本**で、ここには「Web版を開く・Googleログインと Calendar 連携を認証シートで往復させる・通信できないときに再試行させる」ことしか書いていません。既存のWeb/PWA版はそのまま残り、挙動は変えていません。

| 項目 | 値 |
|---|---|
| 表示名 | YoteiFlow |
| Bundle ID | `com.gucchii.yoteiflow` |
| 署名 | Automatic（Apple Developer Program のチーム `6AA3WFTR94`。kurashioと同じチーム） |
| 対応 | iPhone・縦向き・iOS 18以上 |
| 認証シートの戻り先 | `yoteiflow://auth-callback`（ログイン）・`yoteiflow://google-connected`（Calendar連携） |
| Associated Domains / Push / App Group | 使わない（初回スコープ外） |

## 更新が要る場所

| 変えたもの | Web/PWA | iOSアプリ |
|---|---|---|
| 画面・機能（`src/`） | mainへマージ → 自動デプロイ | 何もしなくてよい（次に開いたとき本番の新しい画面が出る） |
| アプリの殻（`ios/`） | 影響なし | Xcodeで入れ直す／TestFlightへ新しいビルドを上げる |

## ビルド方法（Mac + Xcode）

**subpc には Xcode が無い**ため、ビルド・実機確認はMacで行います。

1. Xcode 27系を使う（`project.pbxproj` は Xcode 27 で保存すると `objectVersion = 110`。それより古いXcodeは「新しすぎるプロジェクト形式」で開けない。kurashio #606 と同じ）
2. `open ios/YoteiFlow.xcodeproj`
3. スキーム `YoteiFlow`・実行先を自分のiPhoneにし、Signing & Capabilities の Team が Apple Developer Program のチームになっていることを確かめて ⌘R
4. 初回は iPhone の 設定 → プライバシーとセキュリティ → デベロッパモード をオンにし、設定 → 一般 → VPNとデバイス管理 で開発者証明書を信頼する

署名・App Store Connect APIキー・シェルの注意（終了コードをパイプで隠さない等）は kurashio の `ios/README.md`（`guchi-apps/myroom`）と `guchi-apps/docs#176` を参照してください。この殻は Widget / App Group を持たないため、kurashio より設定は少なくて済みます。

## TestFlight で配布する（#920）

Mac につながなくても、iPhone の TestFlight アプリからインストール・更新できるようにする手順です。**ビルドとアップロードは Mac でしかできません**（subpc に Xcode が無い）。開発用署名の入れ直し（約1年／無料チームなら7日）も TestFlight 版には要りません（TestFlight のビルドは90日で期限切れになるため、そのたびに新しいビルドを上げます）。

| 項目 | 値・運用 |
|---|---|
| App Store Connect のアプリ | 名前 `YoteiFlow`・Bundle ID `com.gucchii.yoteiflow`・チーム `6AA3WFTR94`（初回だけ手作業） |
| 輸出コンプライアンス | `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO`（pbxproj。標準のHTTPS通信のみで独自暗号化は無いため）。毎回の質問は出ない |
| アイコン | `AppIcon.appiconset` の1024px（アルファ無し）。App Store 用はこれ1枚でよい |
| 版番号（`MARKETING_VERSION`） | `package.json` の `version` と揃える。リリースの版上げ（`npm version`）が `version` lifecycle から `sync-version.mjs` を実行し、バンプコミットへ含める（#946）。手で確かめるなら `node ios/scripts/sync-version.mjs`（冪等） |
| ビルド番号（`CURRENT_PROJECT_VERSION`） | アップロードのたびに増える必要がある。スクリプトが Archive 時に日時（`YYYYMMDDHHMM`）で上書きするので、pbxproj は触らずコミットも要らない（`IOS_BUILD_NUMBER` で固定も可） |

### 初回だけ（手作業）

1. [App Store Connect](https://appstoreconnect.apple.com/) → マイApp → 「+」→ 新規App。プラットフォーム iOS・名前 YoteiFlow・プライマリ言語 日本語・Bundle ID `com.gucchii.yoteiflow`・SKU は任意（例 `yoteiflow`）
2. App Store Connect API キーは**新しく作らず、kurashio と共用**する（APIキーはチーム単位のため YoteiFlow にもそのまま使える）。1Password の項目 `apps/MyRoom` の `asc-key-id`・`asc-issuer-id`・`asc-key-p8`（`.p8` の中身をbase64の1行にした値）を `ios/asc.env.tpl` が参照している。**キーの発行・登録は不要**
3. スクリプトは `asc-key-p8` を復号して Mac 上の一時ファイル（権限600）へ書き出し、`xcodebuild` に渡して、終了時（失敗時も）に消す。鍵の中身・パスはログに出さない
4. TestFlight →「内部テスト」にグループを作り、自分（App Store Connect のユーザー）を追加。ビルドの暗号化の質問が出た場合は「いいえ（標準の暗号化のみ）」

### ビルドを上げるたび（subpc から1コマンド・#929）

kurashio の `remote-install.sh` と同じ形で、subpc から Tailscale 越しに Mac（既定 `guchimac-mini`）へSSHして、取り込み → 整合チェック → Archive → アップロードまで行います。**Web側が main へデプロイされた後に**、`main` から上げます。

```bash
node ios/scripts/sync-version.mjs          # 版番号の確認（通常はリリースで同期済みで差分は出ない）
ios/scripts/remote-upload-testflight.sh    # Mac で main を取り込み、TestFlight へ上げる
```

- Mac 側の前提: チェックアウトが `$HOME/apps/yoteiflow` にある（別の場所なら `MAC_REPO_DIR='$HOME/x'`。チルダ付きで渡さない）・Xcode・1Password CLI（`op`）にサインイン済み・ログインキーチェーンが開いている（codesign が失敗したら Mac で `security unlock-keychain ~/Library/Keychains/login.keychain-db` を一度）
- `MAC_HOST`・`MAC_REPO_DIR`・`IOS_BRANCH`（既定 main）・`IOS_SKIP_PULL=1`・`IOS_BUILD_NUMBER` を環境変数で上書きできる。作業ツリーに未コミットの変更があると中止する
- Mac の前にいるなら、Mac のチェックアウトで直接 `op run --env-file=ios/asc.env.tpl -- ios/scripts/upload-testflight.sh`
- **subpc からは実行結果を確かめられない**（Xcode が無い）。初回は Mac で1回通して確かめる

スクリプトは `check-consistency.mjs`（本番URLのまま・Bundle ID等）→ `xcodebuild archive` → `xcodebuild -exportArchive`（`ExportOptions.plist` の `destination: upload` で App Store Connect へ直接アップロード）を順に実行します。**終了コードをパイプで隠さないこと**（`| tee` 等を付けない）。App Store Connect 側の処理（数分〜）が終わると TestFlight に出ます。内部テスターへは審査なしで配布されます。

### TestFlight 版の確認

- [ ] iPhone の TestFlight アプリに YoteiFlow が出て、インストールできる
- [ ] 起動してログイン（上の「実機確認手順」と同じ）でき、再起動してもログインしたまま
- [ ] 新しいビルドを上げると TestFlight から更新できる

> 開発用に Xcode から入れたアプリと TestFlight 版は Bundle ID が同じため上書きされます。入れ替える前にどちらか一方を削除すると確実です。

### 自動化について

`xcodebuild` + App Store Connect API キーでスクリプト化し、subpc から Mac へSSHして1コマンドで上げられます（上記・#929）。CI（GitHub Actions の macOS ランナー）からの自動アップロードは、Mac ランナーの費用・署名証明書の扱いが絡むため、kurashio と同じく見送っています。

## 開発環境と本番の切り替え

`YoteiFlow/AppConfig.swift` の `baseURL` だけを変えます。**LAN IP の `http://` のままではSupabase Authのリダイレクトが戻れない**ため、sslip.io などでホスト名にし、そのURLをSupabaseの許可リダイレクトURLに入れます（`sslip-io-lan-dev` の手順）。**戻すのを忘れてコミットしないこと**（`node ios/scripts/check-consistency.mjs` と `pnpm test:unit` が本番URLかを確かめます）。

## Google / Supabase 側の設定

**新しく登録する URL は不要です。** アプリが認証シートで開くのはWeb版の `/auth/native/start`・`/api/google/connect` で、Supabase・Google に返るのは既存の `https://dayspan.gucchii.com/auth/callback`・`/api/google/callback` だけです。`yoteiflow://` へ戻すのはサーバー（DaySpanの `/auth/callback`・`/api/google/callback`）で、Supabase/Googleの許可リストには登録しません。

ただしログインの戻り先は `/auth/callback?native=1&challenge=…&next=…` とクエリが増えます。Supabaseの Redirect URLs が `https://dayspan.gucchii.com/auth/callback` の完全一致だけだとクエリ付きで弾かれる可能性があるため、**実機で最初のログインが通るかを確かめてください**（既存の `?next=` 付きと同じ扱いのはずですが、subpc では確認できません）。通らなければ `https://dayspan.gucchii.com/auth/callback**` のようにワイルドカードを足します。

## 仕組み

### Googleログイン（認証シート → 引き継ぎコード → WebView）

`ASWebAuthenticationSession` と `WKWebView` は Cookie を共有しません。YoteiFlow のログインは `@supabase/ssr` の Cookie セッションなので、次の方式でWebViewへ引き継ぎます。**認証シートは毎回エフェメラル**（Safariの既存ログインに触れない代わりに、毎回Googleの入力が要る）。

1. Web の `/login` の「Googleでログイン」（素の `<a href="/auth/signin?next=…">`）を、アプリが `decidePolicyFor` で捕まえてWebView内では開かない
2. アプリが PKCE の `verifier`（乱数）と `challenge`（S256）を作り、認証シートで `/auth/native/start?challenge=…&next=…` を開く
3. Google → Supabase → サーバーの `/auth/callback?native=1&…`。**許可メールアドレス（`ALLOWED_GOOGLE_EMAILS`）の確認とユーザー作成は Web版と同じ箇所**で行い、許可外は `yoteiflow://auth-callback?error=not_allowed`
4. サーバーはセッションのトークンを暗号化して60秒だけDBへ置き、**トークンではなく一度限りのコード**だけを `yoteiflow://auth-callback?code=…` で返す
5. アプリはWebViewの中から `POST /auth/native/consume`（本文に `code` と `verifier`）を呼び、通常の Supabase SSR Cookie を受け取ってから `next`（起動画面の設定込み）を開く

使用済み・期限切れ・別用途・verifier不一致のコードはすべて同じ拒否になります。アクセストークン・リフレッシュトークンは、URL・アプリのログ・Swiftのコードのどこにも出ません。コードは `verifier` が無ければ消費できないので、他のアプリが `yoteiflow://` を横取りしてもログインできません。

### Google Calendar連携

1. Web の「接続」リンク（`/api/google/connect`）を捕まえ、ログイン済みのWebViewから `POST /api/google/connect/intent` で一度限りのintent（60秒）を発行
2. 認証シートで `/api/google/connect?intent=…` を開く。**この時点でintentは使い捨て**（クエリはアクセスログに残るため）。サーバーが state を発行し、同意画面へ
3. `/api/google/callback` が state で intent を引き、Cookie の state と一致し未完了のときだけ、**intent のユーザー**へ資格情報を保存（スコープ・offline access・暗号化は Web版と同じ）
4. `yoteiflow://google-connected?result=connected` でアプリへ戻り、設定画面を開き直す

### 外部リンク・通信失敗・ダイアログ

- YoteiFlowと同一オリジン（スキーム・ホスト・ポート）だけをWebView内で開き、他はSafariで開く（`AppConfig.isAppURL`）
- 通信できない・5xx のときは `ConnectionErrorView` が理由と「再読み込み」を出す。回線が戻れば自動で読み直す
- `alert` / `confirm` は `WKUIDelegate` で実装（無いと削除の確認が常に「キャンセル」になる）
- 上端はヘッダーと同じ色（`HeaderBand`）で塗り、WebViewはステータスバーの下から始める
- ログイン状態は WKWebView の既定データストアに残り、再起動しても維持される

### オフライン表示（Service Worker）

`ios/AppInfo.plist` で `WKAppBoundDomains`（`dayspan.gucchii.com`）を宣言し、WebViewで `limitsNavigationsToAppBoundDomains = true` にしています（#927）。これでWKWebViewでもService Workerが動き、PWAと同じ「保存済みの画面をオフラインで開く」「低速回線（3秒）で保存済みへ切り替える」（`public/sw.js`・docs/spec.md §21）がアプリ内で効きます。`ConnectionErrorView` が出るのは、Service Workerが保存済みを返せない場合（初回起動・未保存の画面・Service Worker登録前）だけです。

App-Bound Domains の制約と扱い:

- 宣言外のドメインへの遷移・JavaScript注入はWebView内で制限される。外部リンクは元からSafariで開いており（`AppConfig.isAppURL`）、Google認証・Calendar連携は認証シート（`ASWebAuthenticationSession`）なので影響しない。`callAsyncJavaScript`（引き継ぎコードの消費・intent発行）は宣言したドメインのページ上でだけ実行される
- **宣言は `baseURL` のホストと一致させる**（`check-consistency.mjs` が本番側を照合する）。開発用に `baseURL` を sslip.io 等へ向けるときは、`AppInfo.plist` にも同じホストを足すこと（足さないとWebViewが読み込めない／Service Workerが動かない）。コミット前に本番の値へ戻す
- 宣言できるのは最大10件。いまは1件。将来ほかのドメインをWebView内で開く必要が出たら、その都度ここへ足す（足せない外部サービスは認証シートかSafariで開く）
- Info.plist の配列はビルド設定（`INFOPLIST_KEY_*`）で書けないため、生成されるInfo.plistへ `AppInfo.plist` を統合している

## 実機確認手順

- [ ] ビルドして本人のiPhoneへ入れ、本番YoteiFlowが起動する
- [ ] 「Googleでログイン」で認証シートが開き、許可アカウントでログインするとWebViewの起動画面へ入る
- [ ] アプリを完全終了して開き直してもログインしたまま
- [ ] ログアウト後に保護画面（`/calendar` 等）へ戻れない
- [ ] 許可リスト外のGoogleアカウントは「許可されていません」でログインできない
- [ ] 設定 ▸ Google Calendar で接続・再接続でき、予定の読み書きができる
- [ ] 外部リンクがSafariで開く／一度開いた画面が機内モードでも保存済みで開く（未保存の画面は再試行画面が出て、戻すと自動で読み込む）／低速回線で「保存済みを表示中」が出る／`confirm`（削除の確認）が出る／ノッチ・ホームバー周りが崩れない
- [ ] Safari・PWA・PCの既存ログイン、Calendar連携が今までどおり動く（アプリでログインしてもSafari側がログアウトされない）
- [ ] PRへ画面録画かスクリーンショットを添付する

## 初回スコープ外（後続Issue）

TestFlight配布のCI（macOSランナー）自動化 / APNsによるネイティブ通知（既存のWeb PushはPWA向けとして維持）/ WidgetKit・Live Activity（既存のScriptableウィジェットは維持）/ App Store公開 / ネイティブ画面への置き換え。
