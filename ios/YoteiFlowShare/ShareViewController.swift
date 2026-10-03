import UIKit
import UniformTypeIdentifiers

/// Yahoo!乗換案内の共有から、予定に紐づかない移動を登録する共有拡張（issue #1026・docs/spec.md §29）。
///
/// 受け取った経路のテキストを、停止専用トークン（Keychain・App Group）のBearerで
/// `/api/shortcuts/travel/import` へ送る。読み取りと登録はサーバー側（移動の貼り付けと同じ規則）。
/// 結果は共有シートの中に短く出して閉じる。WebViewのCookieは使えない。
final class ShareViewController: UIViewController {
    private let label = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .body)
        label.text = "移動を登録しています…"
        spinner.startAnimating()

        let stack = UIStackView(arrangedSubviews: [spinner, label])
        stack.axis = .vertical
        stack.spacing = 16
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
        ])

        Task { await importSharedRoute() }
    }

    private func importSharedRoute() async {
        let received = await readSharedItems()
        guard let text = received.text else {
            // Yahoo!アプリの共有シートが何を渡すかは実機でしか確かめられない。URLだけのときは
            // 発着時刻が無く（共有の短縮URLには経路が入っていない）取り込めない。
            let kinds = received.kinds.isEmpty ? "なし" : received.kinds.joined(separator: "・")
            finish("テキストを受け取れませんでした（受け取った項目: \(kinds)）。経路をコピーして、移動の入力欄へ貼り付けてください。")
            return
        }

        guard let token = ActivityStopCredentials.load() else {
            finish("YoteiFlowのアプリでログインしてから、もう一度共有してください。")
            return
        }

        var request = URLRequest(url: SharedConfig.baseURL.appending(path: "api/shortcuts/travel/import"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])
        request.timeoutInterval = 20

        guard let (data, _) = try? await URLSession.shared.data(for: request) else {
            finish("通信に失敗しました。電波の良いところでもう一度共有してください。")
            return
        }
        // 成否によらず本文に日本語の message が入る（ショートカットAPIの規約）
        let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
        finish(message ?? "登録の結果を読み取れませんでした。")
    }

    /// 共有された項目からテキストを取り出す。受け取った項目の型も返す（取り込めなかったときの案内用）
    private func readSharedItems() async -> (text: String?, kinds: [String]) {
        var text: String?
        var kinds: [String] = []
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                kinds.append("テキスト")
                if text == nil,
                   let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String,
                   !value.isEmpty {
                    text = value
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                kinds.append("URL")
            }
        }
        return (text, kinds)
    }

    private func finish(_ message: String) {
        spinner.stopAnimating()
        label.text = message
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
