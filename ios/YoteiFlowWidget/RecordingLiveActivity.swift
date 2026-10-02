import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/// 記録中のライブアクティビティ（#971）。項目名・経過時間・停止ボタンをロック画面と Dynamic Island に出す。
/// 経過時間は `Text(timerInterval:)` で端末が数えるため、サーバーから時間ごとに更新を送る必要は無い。
struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingActivityAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.35))
                .widgetURL(SharedConfig.deepLink(path: "/activity"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.state.title, systemImage: "record.circle")
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    StopButton()
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ElapsedText(startedAt: context.state.startedAt)
                        .font(.system(size: 32, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                }
            } compactLeading: {
                Image(systemName: "record.circle").foregroundStyle(.red)
            } compactTrailing: {
                ElapsedText(startedAt: context.state.startedAt)
                    .monospacedDigit()
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "record.circle").foregroundStyle(.red)
            }
            .widgetURL(SharedConfig.deepLink(path: "/activity"))
        }
    }
}

/// 開始時刻から数え上げる経過時間。終わりを遠い未来にして、止まるまで進み続ける
private struct ElapsedText: View {
    let startedAt: Date

    var body: some View {
        Text(timerInterval: startedAt...startedAt.addingTimeInterval(60 * 60 * 24), countsDown: false)
    }
}

private struct StopButton: View {
    var body: some View {
        Button(intent: StopRecordingIntent()) {
            Label("停止", systemImage: "stop.fill")
                .font(.subheadline.weight(.semibold))
        }
        .tint(.red)
    }
}

private struct LockScreenView: View {
    let state: RecordingActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Label(state.title, systemImage: "record.circle")
                    .font(.headline)
                    .lineLimit(1)
                ElapsedText(startedAt: state.startedAt)
                    .font(.system(size: 34, weight: .semibold, design: .rounded))
                    .monospacedDigit()
            }
            Spacer()
            StopButton()
        }
        .padding()
    }
}
