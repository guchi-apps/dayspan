import SwiftUI
import WidgetKit

// 「今日の予定」と「タスク」を1つの枠に並べるウィジェット（issue #970）。
// 取得は既存の `/api/widget/schedule` と `/api/widget/tasks` をそのまま使い、新しいAPIは増やさない。
// 片方だけ失敗・未設定でも、もう片方は出す（面ごとに状態を持つ）。

struct TodayEntry: TimelineEntry {
    let date: Date
    let schedule: WidgetState<SchedulePayload>
    let tasks: WidgetState<TasksPayload>
}

struct TodayProvider: TimelineProvider {
    private static let sample = TodayEntry(
        date: .now,
        schedule: .ready(SchedulePayload(
            timeZone: "Asia/Tokyo",
            items: [
                .init(kind: "event", title: "会議", allDay: false, start: "2026-01-01T01:00:00.000Z", end: "2026-01-01T02:00:00.000Z", detail: nil, outcome: nil, past: false),
                .init(kind: "event", title: "ランチ", allDay: false, start: "2026-01-01T03:00:00.000Z", end: "2026-01-01T04:00:00.000Z", detail: nil, outcome: nil, past: false),
            ],
            unavailable: nil
        )),
        tasks: .ready(TasksPayload(
            timeZone: "Asia/Tokyo", overdueCount: 1, todayCount: 1, total: 2,
            items: [
                .init(title: "資料を提出", bucket: "overdue", dueLabel: "1日超過", priority: "高"),
                .init(title: "請求書の確認", bucket: "today", dueLabel: "今日", priority: nil),
            ],
            unavailable: nil
        ))
    )

    func placeholder(in context: Context) -> TodayEntry { Self.sample }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        if context.isPreview {
            completion(Self.sample)
            return
        }
        Task { completion(await load()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        Task {
            completion(Timeline(entries: [await load()], policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }

    private func load() async -> TodayEntry {
        async let schedule = WidgetAPI.fetch("schedule", as: SchedulePayload.self)
        async let tasks = WidgetAPI.fetch("tasks", as: TasksPayload.self)
        return TodayEntry(date: .now, schedule: await schedule, tasks: await tasks)
    }
}

struct TodayWidgetView: View {
    let entry: TodayEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(SharedConfig.deepLink(path: "/calendar"))
            .containerBackground(.fill.tertiary, for: .widget)
    }

    // MARK: 面の取り出し

    /// 出せる予定（済んだものは含めない）。出せないときは理由の文言
    private var scheduleResult: Result<[SchedulePayload.Item], Failure> {
        switch entry.schedule {
        case .ready(let p):
            if let reason = p.unavailable {
                return .failure(Failure(text: reason == "google_not_connected" ? "Googleカレンダー未接続" : "予定を取得できません"))
            }
            return .success(p.items)
        case .noToken: return .failure(Failure(text: "アプリでログインしてください"))
        case .unauthorized: return .failure(Failure(text: "トークンが無効です"))
        case .failed: return .failure(Failure(text: "予定を取得できません"))
        }
    }

    private var tasksResult: Result<TasksPayload, Failure> {
        switch entry.tasks {
        case .ready(let p):
            if let reason = p.unavailable {
                return .failure(Failure(text: reason == "notion_not_connected" ? "NotionのタスクDB未設定" : "タスクを取得できません"))
            }
            return .success(p)
        case .noToken: return .failure(Failure(text: "アプリでログインしてください"))
        case .unauthorized: return .failure(Failure(text: "トークンが無効です"))
        case .failed: return .failure(Failure(text: "タスクを取得できません"))
        }
    }

    private struct Failure: Error { let text: String }

    private var timeZone: String {
        if case .ready(let p) = entry.schedule { return p.timeZone }
        if case .ready(let p) = entry.tasks { return p.timeZone }
        return "Asia/Tokyo"
    }

    // MARK: 枠の大きさごとの構成

    @ViewBuilder private var content: some View {
        switch family {
        case .accessoryInline:
            Text(inlineText)
        case .accessoryCircular:
            VStack(spacing: 0) {
                Image(systemName: "checklist")
                Text("\(dueCount ?? 0)").font(.title3.bold())
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                if let next = nextEvent {
                    Text("\(when(next)) \(next.title)").font(.headline).lineLimit(1)
                } else {
                    Text("今日の予定なし").font(.headline)
                }
                Text(dueCount.map { $0 > 0 ? "タスク 期限\($0)件" : "期限のタスクなし" } ?? "タスク −").font(.caption)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemMedium:
            HStack(alignment: .top, spacing: 12) {
                column(title: "今日の予定") { scheduleRows(limit: 3) }
                Divider()
                column(title: "タスク") { taskRows(limit: 3) }
            }
        case .systemLarge:
            VStack(alignment: .leading, spacing: 10) {
                column(title: "今日の予定") { scheduleRows(limit: 5) }
                Divider()
                column(title: "タスク") { taskRows(limit: 5) }
            }
        default: // systemSmall: 次の予定1件とタスクの件数
            VStack(alignment: .leading, spacing: 4) {
                Text("次の予定").font(.caption.bold()).foregroundStyle(.secondary)
                switch scheduleResult {
                case .success:
                    if let next = nextEvent {
                        Text(when(next)).font(.title3.bold()).monospacedDigit()
                        Text(next.title).font(.caption).lineLimit(2)
                    } else {
                        Text("なし").font(.title3.bold())
                    }
                case .failure(let f):
                    Text(f.text).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Text(dueCount.map { $0 > 0 ? "タスク 期限\($0)件" : "期限のタスクなし" } ?? "タスク −")
                    .font(.caption.bold())
                    .foregroundStyle(overdueCount > 0 ? Color.red : Color.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var nextEvent: SchedulePayload.Item? {
        guard case .success(let items) = scheduleResult else { return nil }
        return items.first { !$0.past && $0.outcome == nil }
    }

    private var dueCount: Int? {
        guard case .success(let p) = tasksResult else { return nil }
        return p.overdueCount + p.todayCount
    }

    private var overdueCount: Int {
        guard case .success(let p) = tasksResult else { return 0 }
        return p.overdueCount
    }

    private var inlineText: String {
        let event = nextEvent.map { "\(when($0)) \($0.title)" } ?? "予定なし"
        guard let due = dueCount else { return event }
        return "\(event) ・ タスク\(due)"
    }

    private func when(_ item: SchedulePayload.Item) -> String {
        item.allDay ? "終日" : ISODate.clock(item.start, timeZone: timeZone)
    }

    private func column<Body: View>(title: String, @ViewBuilder _ body: () -> Body) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption.bold()).foregroundStyle(.secondary)
            body()
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    @ViewBuilder private func scheduleRows(limit: Int) -> some View {
        switch scheduleResult {
        case .failure(let f):
            Text(f.text).font(.caption).foregroundStyle(.secondary)
        case .success(let items):
            if items.isEmpty {
                Text("予定はありません").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(Array(items.prefix(limit).enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 6) {
                        Text(when(item)).monospacedDigit().foregroundStyle(.secondary)
                        Text(item.title).lineLimit(1).strikethrough(item.outcome != nil)
                    }
                    .font(.caption)
                    .opacity(item.past || item.outcome != nil ? 0.5 : 1)
                }
                if items.count > limit {
                    Text("ほか \(items.count - limit)件").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private func taskRows(limit: Int) -> some View {
        switch tasksResult {
        case .failure(let f):
            Text(f.text).font(.caption).foregroundStyle(.secondary)
        case .success(let p):
            if p.items.isEmpty {
                Text("期限のタスクはありません").font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(Array(p.items.prefix(limit).enumerated()), id: \.offset) { _, item in
                    HStack(spacing: 6) {
                        Text(item.title).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(item.dueLabel)
                            .foregroundStyle(item.bucket == "overdue" ? Color.red : Color.secondary)
                    }
                    .font(.caption)
                }
                if p.total > limit {
                    Text("ほか \(p.total - limit)件").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "YoteiFlowToday", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
        }
        .configurationDisplayName("今日の予定とタスク")
        .description("今日の予定と、期限切れ・今日のタスクを1つの枠に出します。")
        .supportedFamilies([
            .systemSmall, .systemMedium, .systemLarge,
            .accessoryRectangular, .accessoryCircular, .accessoryInline,
        ])
    }
}
