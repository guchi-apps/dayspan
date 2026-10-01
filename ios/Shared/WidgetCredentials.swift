import Foundation
import Security

/// ウィジェット用トークン（`/api/widget/*` を読むためのBearer）の保管場所。
///
/// ウィジェット拡張はアプリと別プロセスで、WebViewのCookie（Supabaseのセッション）を持てない。
/// そのためログイン済みのWebViewが取得したトークンを、App Group を共有する Keychain へ置き、
/// 拡張がそこから読む。トークンは読み取り専用で、ウィジェットに出す4面しか読めない。
///
/// 端末のロック中もウィジェットは更新されるため、初回アンロック後は読める属性にする。
/// 端末間には同期しない（`ThisDeviceOnly`）。
enum WidgetCredentials {
    private static let service = "com.gucchii.yoteiflow.widget-token"

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: SharedConfig.appGroup,
        ]
    }

    @discardableResult
    static func save(token: String) -> Bool {
        guard let data = token.data(using: .utf8) else { return false }

        let update = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if update == errSecSuccess { return true }
        guard update == errSecItemNotFound else { return false }

        var item = baseQuery
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func clear() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
