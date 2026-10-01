import Foundation

/// アプリとウィジェット拡張の両方が読む定数（#926）。
/// 両方のターゲットへ同じファイルが入る（`Shared` フォルダを両ターゲットの同期グループにしている）。
enum SharedConfig {
    /// Web版のURL。開発サーバーへ向けるときもここだけを変える（ios/README.md）
    static let baseURL = URL(string: "https://dayspan.gucchii.com/")!

    /// アプリとウィジェットで共有する App Group。トークンを入れる Keychain のアクセスグループにも使う。
    /// 両ターゲットの entitlements（`Config/*.entitlements`）と揃えること
    /// （`ios/scripts/check-consistency.mjs` が照合する）
    static let appGroup = "group.com.gucchii.yoteiflow"

    /// ウィジェットを押したときにアプリへ渡すURLのスキーム・ホスト。アプリは `onOpenURL` で受ける
    static let deepLinkScheme = "yoteiflow"
    static let deepLinkHost = "open"

    /// ウィジェットから開ける画面。アプリはこの一覧にあるパスだけを開く
    static let deepLinkPaths: Set<String> = ["/activity", "/calendar", "/tasks", "/shopping"]

    /// `yoteiflow://open?path=/tasks` の形のURLを作る
    static func deepLink(path: String) -> URL {
        var components = URLComponents()
        components.scheme = deepLinkScheme
        components.host = deepLinkHost
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return components.url!
    }

    /// ウィジェットのディープリンクから開く先のパス。許可した画面でなければ nil
    static func path(fromDeepLink url: URL) -> String? {
        guard url.scheme == deepLinkScheme, url.host == deepLinkHost,
              let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                  .queryItems?.first(where: { $0.name == "path" })?.value,
              deepLinkPaths.contains(path)
        else { return nil }
        return path
    }
}
