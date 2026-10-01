import Foundation
import WidgetKit

/// 取得の結果。ウィジェットに「何が足りないか」を出すために失敗を分ける
enum WidgetState<Payload> {
    case ready(Payload)
    /// アプリでログインしておらず、トークンが共有されていない
    case noToken
    /// トークンが失効している（設定でトークンを作り直した・削除した）
    case unauthorized
    case failed
}

/// `/api/widget/<面>` を読む。既存のウィジェットAPIをそのまま使い、新しいAPIは増やさない。
/// 同じ面を複数の枠が取りにきてもサーバー側で3分持ち回される（services/widget/cache.ts）。
enum WidgetAPI {
    static func fetch<Payload: Decodable>(_ surface: String, as type: Payload.Type) async -> WidgetState<Payload> {
        guard let token = WidgetCredentials.load() else { return .noToken }

        var request = URLRequest(url: SharedConfig.baseURL.appending(path: "api/widget/\(surface)"))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 15

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .failed }
            if http.statusCode == 401 { return .unauthorized }
            guard http.statusCode == 200 else { return .failed }
            return .ready(try JSONDecoder().decode(Payload.self, from: data))
        } catch {
            return .failed
        }
    }
}

struct SurfaceEntry<Payload>: TimelineEntry {
    let date: Date
    let state: WidgetState<Payload>
}

/// 4面で共通のタイムライン。更新の間隔は15分（iOSは台本の要求どおりには走らせないため目安）。
/// 記録中の経過時間は `Text(timerInterval:)` で端末が数えるので、この間隔を詰める必要は無い。
struct SurfaceProvider<Payload: Decodable>: TimelineProvider {
    let surface: String
    let sample: Payload

    func placeholder(in context: Context) -> SurfaceEntry<Payload> {
        SurfaceEntry(date: .now, state: .ready(sample))
    }

    func getSnapshot(in context: Context, completion: @escaping (SurfaceEntry<Payload>) -> Void) {
        // ギャラリーの見本はサンプルで出す。実データの取得を待たせない
        if context.isPreview {
            completion(SurfaceEntry(date: .now, state: .ready(sample)))
            return
        }
        Task { completion(SurfaceEntry(date: .now, state: await WidgetAPI.fetch(surface, as: Payload.self))) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SurfaceEntry<Payload>>) -> Void) {
        Task {
            let entry = SurfaceEntry(date: .now, state: await WidgetAPI.fetch(surface, as: Payload.self))
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }
}
