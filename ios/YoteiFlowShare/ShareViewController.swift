import UIKit
import UniformTypeIdentifiers

/// Yahoo!乗換案内の共有から、予定に紐づかない移動を確認して登録する共有拡張（issue #1026/#1054・docs/spec.md §29）。
///
/// 受け取った経路のテキストを、停止専用トークン（Keychain・App Group）のBearerで
/// `/api/shortcuts/travel/preview` へ送って内容を表示し、利用者が登録を押したときだけ import へ送る。
/// 読み取りと登録はサーバー側（移動の貼り付けと同じ規則）。WebViewのCookieは使えない。
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

        Task { await previewSharedRoute() }
    }

    private func previewSharedRoute() async {
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

        var request = URLRequest(url: SharedConfig.baseURL.appending(path: "api/shortcuts/travel/preview"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["text": text])
        request.timeoutInterval = 20

        guard let (data, _) = try? await URLSession.shared.data(for: request) else {
            finish("通信に失敗しました。電波の良いところでもう一度共有してください。")
            return
        }
        guard let response = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              response["ok"] as? Bool == true,
              let travel = response["travel"] as? [String: Any],
              let origin = travel["origin"] as? String,
              let destination = travel["destination"] as? String,
              let departAt = travel["departAt"] as? String,
              let arriveAt = travel["arriveAt"] as? String else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
            finish(message ?? "経路の確認内容を読み取れませんでした。")
            return
        }
        let note = travel["note"] as? String ?? ""
        let timeZone = response["timeZone"] as? String
        showConfirmation(text: text, token: token, origin: origin, destination: destination, departAt: departAt, arriveAt: arriveAt, note: note, timeZone: timeZone)
    }

    private func showConfirmation(text: String, token: String, origin: String, destination: String, departAt: String, arriveAt: String, note: String, timeZone: String?) {
        spinner.stopAnimating()
        let alert = UIAlertController(
            title: "この経路を登録しますか？",
            message: "Yahoo!乗換案内から読み取りました。\n\n\(origin)\n\(displayDate(departAt, timeZone: timeZone)) 発\n↓\n\(destination)\n\(displayDate(arriveAt, timeZone: timeZone)) 着\n\n経路の詳細\n\(note)",
            preferredStyle: .alert,
        )
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { [weak self] _ in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
        alert.addAction(UIAlertAction(title: "この経路を登録", style: .default) { [weak self] _ in
            Task { await self?.importSharedRoute(text: text, token: token) }
        })
        present(alert, animated: true)
    }

    private func importSharedRoute(text: String, token: String) async {
        label.text = "移動を登録しています…"
        spinner.startAnimating()
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
        let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["message"] as? String
        finish(message ?? "登録の結果を読み取れませんでした。")
    }

    private func displayDate(_ value: String, timeZone: String?) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = iso.date(from: value) else { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")
        formatter.timeZone = timeZone.flatMap(TimeZone.init(identifier:)) ?? .current
        formatter.dateFormat = "M月d日（E） HH:mm"
        return formatter.string(from: date)
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
