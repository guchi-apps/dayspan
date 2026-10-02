import Foundation
import HealthKit

/// 睡眠をヘルスケア（HealthKit）へ直接書く（#976・docs/spec.md §40）。
///
/// 何を送るか・印と履歴をいつ進めるかはサーバー（`/api/sleep/health`）が決める。ここは
/// 「取得 → HealthKitへ書く → 確定」の順に進める実行役で、書き終えたあとにだけ確定を呼ぶ
/// （途中で止まった夜が二度と返らなくならないように、ショートカット経路と同じ約束）。
/// 書き込みだけを使い、ヘルスケアの読み取りの許可は求めない。
final class HealthSleepSync {
    /// サーバーとの通信（ログイン済みのWebViewのセッションで行う）。
    /// 戻り値は HTTPステータスと本文。通信できなかったときは nil
    typealias Fetch = (_ method: String, _ body: [String: Any]?) async -> (status: Int, text: String)?

    struct Range {
        let start: Date
        let end: Date
        let startISO: String
        let endISO: String
    }

    private let store = HKHealthStore()
    private let sleepType = HKCategoryType(.sleepAnalysis)

    /// 書き込みの許可の状態。Web側の `NativeHealthPermission` と揃える
    func permission() -> String {
        guard HKHealthStore.isHealthDataAvailable() else { return "unavailable" }
        switch store.authorizationStatus(for: sleepType) {
        case .notDetermined: return "notDetermined"
        case .sharingDenied: return "denied"
        default: return "granted"
        }
    }

    func sync(fetch: Fetch) async -> [String: Any] {
        guard HKHealthStore.isHealthDataAvailable() else { return reply(permission: "unavailable") }

        // 許可の確認は初回だけ画面が出る。拒否済みならここでは出ず、状態だけが返る
        do {
            try await store.requestAuthorization(toShare: [sleepType], read: [])
        } catch {
            return reply(permission: permission(), error: "ヘルスケアの許可を確認できませんでした。")
        }
        guard permission() == "granted" else { return reply(permission: permission()) }

        guard let got = await fetch("GET", nil) else {
            return reply(permission: "granted", error: "サーバーに接続できませんでした。通信状況を確認してください。")
        }
        guard got.status == 200,
              let json = (try? JSONSerialization.jsonObject(with: Data(got.text.utf8))) as? [String: Any]
        else {
            return reply(permission: "granted", error: Self.serverMessage(got.text) ?? "睡眠の記録を取得できませんでした。")
        }

        let items = Self.ranges(json["items"])
        let stale = Self.ranges(json["stale"])
        let until = json["until"] as? String

        // 送ったあとに直した古い時間帯は、先に自分が書いたぶんを消す。新しい時間帯を書いてから消すと、
        // 古い範囲に含まれる新しいサンプルまで消えうる。消せなかったもの（ショートカットで送った
        // 分など）は、利用者に消してもらうため返す
        var removed = 0
        var staleLeft: [Range] = []
        for range in stale {
            if await deleteOwnSamples(in: range) > 0 {
                removed += 1
            } else {
                staleLeft.append(range)
            }
        }

        if !items.isEmpty {
            let samples = items.map { range in
                HKCategorySample(
                    type: sleepType,
                    value: HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
                    start: range.start,
                    end: range.end
                )
            }
            do {
                try await store.save(samples)
            } catch {
                // 書けなかったときは確定を呼ばない（次回また返る）
                return reply(permission: permission(), error: "ヘルスケアへ書き込めませんでした。")
            }
        }

        // 書き終えたあとに印と履歴を進める。失敗しても書いたぶんは残るが、次回その夜をもう一度
        // 返してしまうため、理由を伝える
        if let until {
            let committed = await fetch("POST", ["until": until])
            guard let committed, committed.status == 200 else {
                return reply(
                    permission: "granted", sent: items.count, removed: removed, staleLeft: staleLeft,
                    error: "ヘルスケアへは送りましたが、送った記録をサーバーへ残せませんでした。次回もう一度送られる場合があります。"
                )
            }
        }

        return reply(permission: "granted", sent: items.count, removed: removed, staleLeft: staleLeft)
    }

    /// 自分（このアプリ）が書いた睡眠のうち、時間帯が一致するものを消す。消した件数を返す。
    /// 他のアプリ・Apple Watch が書いたものは消せない（HealthKitの仕様）。秒の丸めの差を
    /// 吸収するため、前後1秒の幅で完全に収まるものを対象にする
    private func deleteOwnSamples(in range: Range) async -> Int {
        let time = HKQuery.predicateForSamples(
            withStart: range.start.addingTimeInterval(-1),
            end: range.end.addingTimeInterval(1),
            options: [.strictStartDate, .strictEndDate]
        )
        let own = HKQuery.predicateForObjects(from: HKSource.default())
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [time, own])
        return (try? await store.deleteObjects(of: sleepType, predicate: predicate)) ?? 0
    }

    private func reply(
        permission: String,
        sent: Int = 0,
        removed: Int = 0,
        staleLeft: [Range] = [],
        error: String? = nil
    ) -> [String: Any] {
        var result: [String: Any] = [
            "permission": permission,
            "sent": sent,
            "removed": removed,
            "staleLeft": staleLeft.map { ["start": $0.startISO, "end": $0.endISO] },
        ]
        if let error { result["error"] = error }
        return result
    }

    private static func ranges(_ value: Any?) -> [Range] {
        guard let array = value as? [[String: Any]] else { return [] }
        return array.compactMap { item in
            guard let startISO = item["start"] as? String, let endISO = item["end"] as? String,
                  let start = parseDate(startISO), let end = parseDate(endISO), end > start
            else { return nil }
            return Range(start: start, end: end, startISO: startISO, endISO: endISO)
        }
    }

    /// サーバーの日時は `2026-10-02T23:35:00+09:00` と `...Z`（ミリ秒あり）の両方がありうる
    private static func parseDate(_ text: String) -> Date? {
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        if let date = plain.date(from: text) { return date }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: text)
    }

    private static func serverMessage(_ text: String) -> String? {
        let json = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
        return json?["message"] as? String
    }
}
