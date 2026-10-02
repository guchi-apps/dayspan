import SwiftUI
import WidgetKit

@main
struct YoteiFlowApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @StateObject private var model = WebViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            // ステータスバーの部分はWebのヘッダーと同じ色で塗る。WebViewはステータスバーの
            // 下から始めるので、スクロールした内容が上端へ潜らない
            Color("HeaderBand").ignoresSafeArea()

            WebViewContainer(webView: model.webView)
                .ignoresSafeArea(edges: .bottom)

            if let failure = model.failure {
                ConnectionErrorView(failure: failure, isRetrying: model.isRetrying, retry: model.retry)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.failure)
        .onAppear { model.startIfNeeded() }
        // ウィジェットの押下。認証シートの戻り先（auth-callback など）は認証シートが受けるため、ここへは来ない
        .onOpenURL { model.openFromWidget($0) }
        .onChange(of: scenePhase) { _, phase in
            // 別アプリへ行っているあいだに回線が戻っていることがある
            if phase == .active, model.failure != nil { model.retry() }
            // 記録の開始・停止はWebの中で行われ、アプリへは伝わらない。開いたとき・戻ったときに
            // ウィジェットを取り直させて、古い値が残らないようにする
            if phase == .active {
                WidgetCenter.shared.reloadAllTimelines()
                // 食い違うライブアクティビティの片付け・取り残しの表示（#971）
                Task { await LiveActivityCoordinator.shared.reconcile() }
            }
        }
    }
}
