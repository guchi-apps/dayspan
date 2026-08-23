import { LinearProgress } from "@/components/ui/linear-progress";

/**
 * どの画面にも当てはまる読み込み中の面（issue #352）。
 *
 * 中身の形は画面ごとに違うため、ここでは骨組みを描かない。形の分かる画面は
 * 自前の loading.tsx を持つ（calendar・tasks・activity）。
 *
 * 置いてある理由は表示だけではない。この境界が無いと、動的なページはレンダーが
 * 終わるまでHTMLが1バイトも流れず、レイアウトに置いた起動画面（AppLaunchScreen）の
 * 描画までサーバーの応答を丸ごと待つことになる。
 */
export default function Loading() {
  return (
    <div className="flex h-dvh flex-col bg-background">
      <LinearProgress active />
    </div>
  );
}
