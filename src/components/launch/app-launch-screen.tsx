import { APP_ICON_BACKGROUND, APP_ICON_FOREGROUND, AppIconGlyph } from "@/lib/app-icon-glyph";

/**
 * アプリを開いてから操作を受けられるようになるまでのあいだ出す起動画面（docs/spec.md §33）。
 *
 * ホーム画面から開くと、iOSの起動画面が消えたあと、認証（src/proxy.ts）→DB→HTML到着→JS の
 * あいだ画面が真っ白になる。起動そのものを速くするのではなく、その空白を埋めるためのもの。
 *
 * 面の色はアイコンと同じ紫にする。manifest.ts の background_color も同じ値のため、
 * iOSが作る起動画面ではアイコンの角丸の器が背景に溶けて白い図柄だけが残り、
 * OS側とこの画面がほぼ同じ絵になる。境目でアイコンが動かなければ、白い空白があった時間は
 * そのまま起動画面が続いていたように見える。
 *
 * ルート単位の loading.tsx ではなくレイアウトのオーバーレイにしているのは、下部ナビで
 * 記録の画面へ移るたびに全面のアイコンが挟まるのを避けるため。消える・出るを決めるのは
 * globals.css の #app-launch で、いちど消えたら同じドキュメントの中では二度と出ない。
 */
export function AppLaunchScreen() {
  return (
    <div
      id="app-launch"
      // 読み上げの対象にしない。中身は待っていることを示す絵で、読み上げるものが無い。
      aria-hidden="true"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5"
      style={{ backgroundColor: APP_ICON_BACKGROUND }}
    >
      {/*
        新デザイン（issue #872）は図形が自身のviewBox内で占める割合が旧デザインより小さいため、
        88のままだと図柄がひとまわり小さく見える。旧デザインでの実際の可視サイズ（88px中
        およそ66px）に近づくよう引き上げている。
      */}
      <AppIconGlyph size={110} />

      <div className="type-title-medium" style={{ color: APP_ICON_FOREGROUND }}>
        Koyomio
      </div>

      {/*
        アプリ内の LinearProgress と同じ動き。色だけは紫の面に乗せるため白側で組む
        （M3のトークンはダークで --md-primary が淡い紫になり、この面では沈む）。
      */}
      <div className="h-1 w-24 overflow-hidden rounded-full bg-white/25">
        <div
          className="h-full w-2/5 rounded-full animate-[linear-progress_1.1s_ease-in-out_infinite]"
          style={{ backgroundColor: APP_ICON_FOREGROUND }}
        />
      </div>
    </div>
  );
}
