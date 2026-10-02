import ActivityKit
import Foundation

/// 記録中のライブアクティビティ（#971）。アプリとウィジェット拡張の両方が使う。
///
/// 型名はサーバーの `LIVE_ACTIVITY_ATTRIBUTES_TYPE`（src/lib/live-activity/payload.ts）と揃える
/// （push-to-start で OS がこの型名でアクティビティを作る）。
struct RecordingActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// 記録中の項目名
        var title: String
        /// 開始時刻（Unix秒）。ActivityKit は既定の JSONDecoder で復号するため、Date ではなく
        /// 数値で持つ（サーバーが ISO 文字列を送ると復号に失敗して更新が無視される）
        var startedAtEpoch: Double

        var startedAt: Date { Date(timeIntervalSince1970: startedAtEpoch) }
    }
}
