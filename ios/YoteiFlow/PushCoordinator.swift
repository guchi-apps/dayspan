import Foundation
import UIKit
import UserNotifications

/// APNsの通知まわりの状態をAppDelegateとWebViewModelの間で受け渡す。
///
/// WKWebViewの中ではWeb Pushが動かないため、アプリはAPNsで通知を受ける（#925）。
/// 許可を求める・デバイストークンを受け取る・通知を押された画面を開く、のうち、
/// UIKitのコールバック（AppDelegate）で起きるものを、WebViewを持つ側へ渡すための入れ物。
final class PushCoordinator {
    static let shared = PushCoordinator()

    /// APNsのデバイストークン（16進）。システムが渡してくるまでは nil
    private(set) var deviceToken: String?

    /// 通知を押されたときに開く画面。WebViewModelが見える範囲まで起動していなければ溜めておく
    private var pendingPath: String?
    var onOpenPath: ((String) -> Void)? {
        didSet {
            if let path = pendingPath, let handler = onOpenPath {
                pendingPath = nil
                handler(path)
            }
        }
    }

    /// トークンが届いたことをWebViewModelへ知らせる（登録APIはログイン済みのWebViewから呼ぶため）
    var onTokenChanged: (() -> Void)?

    private var didRequestThisLaunch = false

    /// 開発用ビルド（Xcodeから入れたもの）のトークンはsandbox、TestFlight・App Storeはproduction。
    /// サーバーはこの値で送り先のホストを切り替える
    var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// 通知の許可を求め、許可されたらAPNsへ登録する。ログイン後の最初の画面で1回だけ呼ぶ
    /// （ログイン前に許可を求めても、トークンを結び付けるユーザーがまだ居ない）。
    /// 一度拒否された場合、システムは再度は尋ねず、ここは何もしない（設定アプリから変える）
    func requestAuthorizationIfNeeded() {
        guard !didRequestThisLaunch else { return }
        didRequestThisLaunch = true

        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(deviceToken data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        onTokenChanged?()
    }

    func open(path: String) {
        if let handler = onOpenPath {
            handler(path)
        } else {
            pendingPath = path
        }
    }
}

/// UIKitのコールバックを受ける。SwiftUIの App からは `@UIApplicationDelegateAdaptor` で繋ぐ
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // 起動時に押された通知（アプリが終了していた場合）も、起動後に didReceive で届く
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushCoordinator.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // 機内モード・シミュレータなどで起きる。次の起動でやり直すので、ここでは何もしない
    }

    /// アプリを開いている間も通知を出す（予定の直前に気付けるように）
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    /// 通知を押されたら、その通知の画面（`path`）をWebViewで開く。
    /// 相対パス以外（他のオリジン）は WebViewModel 側で弾く
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let path = response.notification.request.content.userInfo["path"] as? String else { return }
        PushCoordinator.shared.open(path: path)
    }
}
