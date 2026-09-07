import { APP_ICON_BACKGROUND, APP_ICON_FOREGROUND } from "@/lib/app-icon-glyph";
import { DEFAULT_HOME_PATH } from "@/lib/home-path";

/**
 * iPhoneウィジェットの飛び先になる受け渡しページのパス（docs/spec.md §28・issue #562）。
 *
 * ウィジェットからは `webapp://<ホスト>` を直接開けないことがある。ショートカットからは
 * 動く報告があるが、Appleの公開ドキュメントには無いスキームで、ウィジェットのタップや
 * Scriptableの `Safari.open()` から渡したときに効くかは端末次第。効かないと押しても
 * 何も起きず、利用者にはその理由が読めない。
 *
 * そこでウィジェットへは必ず開ける `https://` のURLを入れ、そのページからホーム画面の
 * DaySpanへ渡す。渡せなかったときも、同じページからブラウザのDaySpanへ入れる。
 *
 * middleware（認証を通さないパスの判定）とルートハンドラが同じ値を見る。
 * `src/lib/scriptable-widget.ts` にも同じ値の写しがある（あちらは他のモジュールをimportしない
 * 前提で作られており、`scripts/preview-widget.mjs` がその前提に乗っている）。変えるときは両方直す。
 */
export const WIDGET_OPEN_BRIDGE_PATH = "/open";

/**
 * 受け渡しページのHTML。
 *
 * 差し込む値を持たない（ホストはブラウザ側の `location.host` から組み立てる）ため、
 * 引数の無い純関数にしてある。tsc + node で出力をそのまま読んで確かめられる。
 *
 * Reactのページ（`page.tsx`）にしないのは、ルートレイアウトの起動画面・フォント・
 * Service Workerの登録・React本体を、Safariの素の状態で丸ごと読むことになるため。
 * このページの仕事は次の場所へ渡すことだけで、読み込みの重さがそのまま待ち時間になる。
 * middlewareが手書きのHTMLを返している `serviceUnavailable()` と同じ扱い。
 *
 * 地の色はアイコン・起動画面と同じ紫にする（docs/spec.md §33）。Safariで一瞬出るこの面が
 * 起動画面と地続きに見え、渡す途中で別の画面を挟んだようには見えない。
 *
 * ページを開いた時点では `webapp://` を試さない。扱えない端末のSafariは、そのスキームへ
 * 進もうとした時点で「ページを開けません。アドレスが無効です。」という消すまで操作を受け付けない
 * 警告を出す（issue #566）。押した覚えのない警告が毎回出るうえ、こちらから抑える手立てが無い。
 * 開ける端末かどうかは事前に判別できないため、どちらへ渡すかは押して選んでもらう。
 */
export function buildWidgetOpenBridgeHtml(): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="${APP_ICON_BACKGROUND}" />
    <meta name="robots" content="noindex" />
    <title>DaySpan を開く</title>
    <style>
      html, body { height: 100%; }
      body {
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        box-sizing: border-box;
        background: ${APP_ICON_BACKGROUND};
        color: ${APP_ICON_FOREGROUND};
        font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
        text-align: center;
        -webkit-text-size-adjust: 100%;
      }
      main { display: flex; flex-direction: column; gap: 16px; max-width: 20rem; width: 100%; }
      h1 { font-size: 1.25rem; font-weight: 600; margin: 0; }
      p { margin: 0; font-size: 0.875rem; opacity: 0.85; line-height: 1.6; }
      [hidden] { display: none !important; }
      .actions { display: flex; flex-direction: column; gap: 8px; }
      a {
        display: block;
        padding: 12px 16px;
        border-radius: 9999px;
        border: 1px solid ${APP_ICON_FOREGROUND};
        color: ${APP_ICON_FOREGROUND};
        text-decoration: none;
        font-size: 0.9375rem;
      }
      a.primary { background: ${APP_ICON_FOREGROUND}; color: ${APP_ICON_BACKGROUND}; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <h1>DaySpan を開く</h1>
      <p id="status">ホーム画面に追加した DaySpan と、このままブラウザのどちらで開くかを選んでください。</p>

      <!--
        リンクは素の <a> で置く。スクリプトから開くと、アプリが入っていてもブラウザへ落ちることが
        ある（CLAUDE.md のYahoo!乗換案内の判断と同じ）。ホーム画面の DaySpan の側だけ最初は
        隠しておくのは、宛先（webapp://<ホスト>）がブラウザ側でしか組み立てられないため。
      -->
      <div class="actions">
        <a class="primary" id="app-link" href="#" hidden>ホーム画面の DaySpan を開く</a>
        <a id="browser-link" href="${DEFAULT_HOME_PATH}">このままブラウザで開く</a>
      </div>

      <p id="note" hidden></p>
    </main>

    <script>
      (function () {
        var status = document.getElementById("status");
        var appLink = document.getElementById("app-link");
        var note = document.getElementById("note");

        function showNote(message) {
          note.textContent = message;
          note.hidden = false;
        }

        // すでにホーム画面の DaySpan の中で開かれていたら、渡す相手は自分自身になる。
        // そのまま選ばせても行き先が同じなので、記録の画面へ送って終わる。
        var standalone =
          window.navigator.standalone === true ||
          (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

        if (standalone) {
          location.replace(${JSON.stringify(DEFAULT_HOME_PATH)});
          return;
        }

        // http のサイトはホーム画面へWebアプリとして追加できず、webapp:// の宛先になりようがない
        // （src/lib/scriptable-widget.ts の toWebAppUrl() と同じ判断）。
        if (location.protocol !== "https:") {
          status.textContent = "このままブラウザで開きます。";
          showNote("http のアドレスではホーム画面の DaySpan を開けません。");
          return;
        }

        appLink.href = "webapp://" + location.host;
        appLink.hidden = false;

        // 扱えない端末では、押した先で「アドレスが無効です」と出てこのページに留まる。
        // 何が起きたのか・次にどうすればよいのかがその画面からは読めないため、こちらで添える。
        // 切り替わった端末では画面が隠れるので、この案内は目に入らない。
        appLink.addEventListener("click", function () {
          setTimeout(function () {
            if (document.visibilityState === "hidden") return;

            showNote(
              "ホーム画面の DaySpan へ切り替わらないときは、この端末では開けません。" +
                "「このままブラウザで開く」を使ってください。" +
                "設定 ▸ iPhoneウィジェット から、押したときブラウザで開くように変えられます。",
            );
          }, 1500);
        });
      })();
    </script>
  </body>
</html>
`;
}
