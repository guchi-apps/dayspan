import Foundation

/// 起動時・前面に戻ったときに、サーバーの記録中と手元のアクティビティを突き合わせる判定（#971）。
///
/// push-to-start で作られたアクティビティがすでに出ているのに、起動時にもう一度 request すると
/// 同じ記録のアクティビティが2つになる。純粋関数にして読みやすくしている。
enum LiveActivityReconcile {
    struct Running: Equatable {
        var title: String
        var startedAtEpoch: Double
    }

    enum Action: Equatable {
        /// 手元に1つも無いので、記録中を表示する
        case request(Running)
        /// 食い違う（終わった記録・別の記録）手元のアクティビティを終わらせる（インデックスは `existing` の位置）
        case end(index: Int)
        /// 手元の内容をサーバーの記録に合わせる
        case update(index: Int, Running)
    }

    static func decide(running: Running?, existing: [Running]) -> [Action] {
        guard let running else {
            return existing.indices.map { .end(index: $0) }
        }
        if existing.isEmpty { return [.request(running)] }

        var actions: [Action] = []
        var keptOne = false
        for (index, item) in existing.enumerated() {
            if !keptOne {
                keptOne = true
                if item != running { actions.append(.update(index: index, running)) }
            } else {
                // 同じ記録のアクティビティが複数あっても、残すのは1つだけ
                actions.append(.end(index: index))
            }
        }
        return actions
    }
}
