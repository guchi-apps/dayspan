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
| アプリの殻（`ios/`） | 影響なし | Xcodeで入れ直す |

## ビルド方法（Mac + Xcode）

**subpc には Xcode が無い**ため、ビルド・実機確認はMacで行います。

1. Xcode 27系を使う（`project.pbxproj` は Xcode 27 で保存すると `objectVersion = 110`。それより古いXcodeは「新しすぎるプロジェクト形式」で開けない。kurashio #606 と同じ）
2. `open ios/YoteiFlow.xcodeproj`
3. スキーム `YoteiFlow`・実行先を自分のiPhoneにし、Signing & Capabilities の Team が Apple Developer Program のチームになっていることを確かめて ⌘R
4. 初回は iPhone の 設定 → プライバシーとセキュリティ → デベロッパモード をオンにし、設定 → 一般 → VPNとデバイス管理 で開発者証明書を信頼する

署名・App Store Connect APIキー・シェルの注意（終了コードをパイプで隠さない等）は kurashio の `ios/README.md`（`guchi-apps/myroom`）と `guchi-apps/docs#176` を参照してください。この殻は Widget / App Group を持たないため、kurashio より設定は少なくて済みます。

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

### オフライン表示について

WKWebView では Service Worker を使えません（App-Bound Domains を宣言していないため）。PWA で効く「保存済みの画面をオフラインで開く・低速回線で保存済みへ切り替える」仕組みは、**アプリ内では効きません**。代わりに再試行の画面を出します。対応するなら `WKAppBoundDomains` の宣言が要るため、後続Issueで扱います。

## 実機確認手順

- [ ] ビルドして本人のiPhoneへ入れ、本番YoteiFlowが起動する
- [ ] 「Googleでログイン」で認証シートが開き、許可アカウントでログインするとWebViewの起動画面へ入る
- [ ] アプリを完全終了して開き直してもログインしたまま
- [ ] ログアウト後に保護画面（`/calendar` 等）へ戻れない
- [ ] 許可リスト外のGoogleアカウントは「許可されていません」でログインできない
- [ ] 設定 ▸ Google Calendar で接続・再接続でき、予定の読み書きができる
- [ ] 外部リンクがSafariで開く／機内モードで再試行画面が出て、戻すと自動で読み込む／`confirm`（削除の確認）が出る／ノッチ・ホームバー周りが崩れない
- [ ] Safari・PWA・PCの既存ログイン、Calendar連携が今までどおり動く（アプリでログインしてもSafari側がログアウトされない）
- [ ] PRへ画面録画かスクリーンショットを添付する

## 初回スコープ外（後続Issue）

TestFlight配布と自動化 / APNsによるネイティブ通知（既存のWeb PushはPWA向けとして維持）/ WidgetKit・Live Activity（既存のScriptableウィジェットは維持）/ App Store公開 / `WKAppBoundDomains` によるオフライン対応 / ネイティブ画面への置き換え。
