import SwiftUI
import Combine
import UIKit
import PhotosUI
import LocalAuthentication
import Security

struct Incident: Codable, Identifiable {
    let id: String
    let description: String
    let status: String
    let version: Int
    let outcome: String?
    let reason: String
    let created_at: String
}
struct Profile: Codable, Identifiable {
    let id: String
    let kind: String
    let reference: String
    let name: String
    let basis: String
    let status: String
    let expires: String
    let photo_count: Int
}
struct PhotoRecord: Codable, Identifiable { let id: String }
struct Items<T: Codable>: Codable { let items: [T] }
struct Session: Codable { let token: String }
struct ServiceError: LocalizedError { let message: String; var errorDescription: String? { message } }

enum SecureSession {
    static func save(_ token: String, origin: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.ayonix.retailguard.reference.session", kSecAttrAccount as String: origin]
        SecItemDelete(query as CFDictionary)
        var record = query
        record[kSecValueData as String] = Data(token.utf8)
        record[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(record as CFDictionary, nil) == errSecSuccess else { throw ServiceError(message: "Unable to store session securely") }
    }
    static func load(origin: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.ayonix.retailguard.reference.session", kSecAttrAccount as String: origin,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func delete(origin: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.ayonix.retailguard.reference.session", kSecAttrAccount as String: origin]
        SecItemDelete(q as CFDictionary)
    }
}

@MainActor final class API: ObservableObject {
    @Published var authenticated = false
    @Published var error = ""
    @Published var busy = false
    @Published var origin = UserDefaults.standard.string(forKey: "referenceOrigin") ?? ""
    @Published var japanese = Locale.preferredLanguages.first?.hasPrefix("ja") == true
    var token = ""
    func t(_ en: String, _ ja: String) -> String { japanese ? ja : en }
    func url(_ path: String) throws -> URL {
        guard let base = URL(string: origin), let host = base.host,
              base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
              (base.path.isEmpty || base.path == "/") else { throw ServiceError(message: t("Enter a valid service origin", "有効なサービスURLを入力してください")) }
        let local = ["localhost", "127.0.0.1", "::1"].contains(host)
        #if DEBUG
        let permitted = base.scheme == "https" || (base.scheme == "http" && local)
        #else
        let permitted = base.scheme == "https"
        #endif
        guard permitted else { throw ServiceError(message: t("HTTPS is required", "HTTPSが必要です")) }
        guard let u = URL(string: origin.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else { throw ServiceError(message: "Invalid URL") }
        return u
    }
    func bytes(_ path: String, method: String = "GET", payload: [String: Any]? = nil) async throws -> Data {
        var request = URLRequest(url: try url(path)); request.httpMethod = method; request.timeoutInterval = 20
        if !token.isEmpty { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let payload { request.httpBody = try JSONSerialization.data(withJSONObject: payload); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ServiceError(message: "Invalid response") }
        guard (200...299).contains(http.statusCode) else {
            let p = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            if http.statusCode == 401 { authenticated = false; token = ""; SecureSession.delete(origin: origin) }
            throw ServiceError(message: "\(p?["code"] as? String ?? "Request failed") (\(http.statusCode))")
        }
        return data
    }
    func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T { try JSONDecoder().decode(type, from: try await bytes(path)) }
    func signIn(email: String, password: String) async {
        busy = true; error = ""; defer { busy = false }
        do {
            let data = try await bytes("/api/login", method: "POST", payload: ["email":email,"password":password])
            let s = try JSONDecoder().decode(Session.self, from: data)
            try SecureSession.save(s.token, origin: origin)
            token = s.token; authenticated = true; UserDefaults.standard.set(origin, forKey: "referenceOrigin")
        } catch { self.error = error.localizedDescription }
    }
    func unlock() async {
        busy = true; error = ""; defer { busy = false }
        do {
            guard let saved = SecureSession.load(origin: origin) else { throw ServiceError(message: t("Sign in first", "先にログインしてください")) }
            let context = LAContext(); var authError: NSError?
            guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError) else { throw ServiceError(message: t("Biometric unlock is unavailable; use normal sign-in", "生体認証を利用できません。通常のログインを使用してください")) }
            let accepted = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: t("Unlock your RetailGuard session", "RetailGuardのセッションを解除します"))
            guard accepted else { return }
            token = saved; _ = try await bytes("/api/me"); authenticated = true
        } catch { token = ""; self.error = error.localizedDescription }
    }
    func signOut() async {
        _ = try? await bytes("/api/logout", method: "POST", payload: [:])
        SecureSession.delete(origin: origin); token = ""; authenticated = false
    }
}

@main struct RetailGuardApp: App {
    @StateObject private var api = API()
    var body: some Scene { WindowGroup { RootView().environmentObject(api) } }
}
struct RootView: View {
    @EnvironmentObject var api: API
    @Environment(\.scenePhase) private var phase
    var body: some View {
        Group {
            if api.authenticated {
                TabView {
                    IncidentList(search: false).tabItem { Label(api.t("Alerts", "通知"), systemImage: "bell") }
                    IncidentList(search: true).tabItem { Label(api.t("Records", "記録"), systemImage: "magnifyingglass") }
                    ProfileList().tabItem { Label(api.t("Enrollment", "登録"), systemImage: "person.crop.rectangle") }
                    SettingsView().tabItem { Label(api.t("Settings", "設定"), systemImage: "gearshape") }
                }.tint(.teal)
            } else { LoginView() }
        }
        .onChange(of: phase) { _, newPhase in
            if newPhase == .background && api.authenticated { api.authenticated = false; api.token = "" }
        }
    }
}
struct LoginView: View {
    @EnvironmentObject var api: API
    @State private var email = "admin@local.retailguard"
    @State private var password = ""
    var body: some View {
        NavigationStack {
            Form {
                Section { Text("Ayonix RetailGuard").font(.title2.bold()); Text(api.t("Connected reference client — manual workflows only", "接続型参照クライアント・手動ワークフロー専用")).font(.caption) }
                Section(api.t("Service", "接続先")) { TextField(api.t("HTTPS origin", "HTTPSサービスURL"), text: $api.origin).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled() }
                Section(api.t("Sign in", "ログイン")) {
                    TextField("Email", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField(api.t("Password", "パスワード"), text: $password)
                    Button(api.t("Sign in", "ログイン")) { Task { await api.signIn(email: email, password: password); password = "" } }.disabled(api.busy || password.isEmpty)
                    Button(api.t("Unlock with biometrics", "生体認証でロック解除")) { Task { await api.unlock() } }.disabled(api.busy)
                }
                if !api.error.isEmpty { Section { Text(api.error).foregroundStyle(.red).accessibilityLabel(api.error) } }
                Section { Toggle("日本語", isOn: $api.japanese) }
            }.navigationTitle(api.t("Secure access", "安全なアクセス"))
        }
    }
}
struct IncidentList: View {
    @EnvironmentObject var api: API
    let search: Bool
    @State private var items: [Incident] = []
    @State private var query = ""
    @State private var error = ""
    @State private var loading = false
    func load() async {
        loading = true; defer { loading = false }
        do {
            var components = URLComponents(); components.queryItems = [URLQueryItem(name: "q", value: query)]
            let path = "/api/incidents" + (query.isEmpty ? "" : "?" + (components.percentEncodedQuery ?? ""))
            let r: Items<Incident> = try await api.get(path, as: Items<Incident>.self)
            items = search ? r.items : r.items.filter { $0.status != "resolved" }; error = ""
        } catch { self.error = error.localizedDescription }
    }
    var body: some View {
        NavigationStack {
            List {
                if search { Section { TextField(api.t("Search description, reason or ID", "説明・理由・番号で検索"), text: $query).onSubmit { Task { await load() } }; Button(api.t("Search", "検索")) { Task { await load() } } } }
                if loading { ProgressView() }
                if !error.isEmpty { Text(error).foregroundStyle(.red) }
                if items.isEmpty && !loading { Text(api.t("No records. Camera inference is not included in the reference.", "記録はありません。参照クライアントに映像検知は含まれません。")).foregroundStyle(.secondary) }
                ForEach(items) { i in NavigationLink { IncidentDetail(incident: i) } label: { VStack(alignment: .leading, spacing: 6) { Text(i.description).font(.headline); Text("\(i.status) · \(i.created_at)").font(.caption).foregroundStyle(.secondary) } } }
            }.navigationTitle(api.t(search ? "Past records" : "Alert review", search ? "過去記録" : "アラート確認"))
                .refreshable { await load() }.task { await load() }
        }
    }
}
struct IncidentDetail: View {
    @EnvironmentObject var api: API
    @State var incident: Incident
    @State private var reason = ""
    @State private var outcome = "inconclusive"
    @State private var error = ""
    @State private var busy = false
    func transition(_ action: String) async {
        busy = true; defer { busy = false }
        do {
            let data = try await api.bytes("/api/incidents/\(incident.id)/transition", method: "POST", payload: ["action":action,"expected_version":incident.version,"reason":reason,"outcome":outcome])
            incident = try JSONDecoder().decode(Incident.self, from: data); error = ""; reason = ""
        } catch { self.error = error.localizedDescription }
    }
    var body: some View {
        Form {
            Section(api.t("Observed record", "記録された事実")) { Text(incident.description); Text(incident.id).font(.caption); LabeledContent(api.t("Status", "状態"), value: incident.status); LabeledContent(api.t("Version", "更新番号"), value: String(incident.version)) }
            Section { Text(api.t("This reference record contains manual facts, not an inference clip. Production must supply authorized evidence.", "参照記録は手動入力です。推論動画は含まれません。製品版では権限のある証拠を表示します。")).font(.caption) }
            if incident.status != "resolved" {
                Section(api.t("Review", "確認")) {
                    TextField(api.t("Reason required", "理由を入力してください"), text: $reason, axis: .vertical)
                    if incident.status != "new" { Picker(api.t("Outcome", "結果"), selection: $outcome) { Text(api.t("Inconclusive", "判断保留")).tag("inconclusive"); Text(api.t("False alert", "誤通知")).tag("false_alert"); Text(api.t("Confirmed incident", "事案として確認")).tag("confirmed") } }
                    Button(api.t(incident.status == "new" ? "Acknowledge" : "Record outcome", incident.status == "new" ? "対応開始" : "結果を記録")) { Task { await transition(incident.status == "new" ? "acknowledge" : "resolve") } }.disabled(busy || reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } else { Section(api.t("Outcome", "確認結果")) { Text(incident.outcome ?? ""); Text(incident.reason) } }
            if !error.isEmpty { Section { Text(error).foregroundStyle(.red); Button(api.t("Refresh current record", "最新の記録を取得")) { Task { do { incident = try await api.get("/api/incidents/\(incident.id)", as: Incident.self); error = "" } catch { self.error = error.localizedDescription } } } } }
        }.navigationTitle(api.t("Incident", "事案"))
    }
}
struct ProfileList: View {
    @EnvironmentObject var api: API
    @State private var profiles: [Profile] = []
    @State private var error = ""
    @State private var enrolling = false
    func load() async { do { profiles = try await api.get("/api/profiles", as: Items<Profile>.self).items; error = "" } catch { self.error = error.localizedDescription } }
    var body: some View {
        NavigationStack { List {
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
            ForEach(profiles) { p in NavigationLink { ProfileDetail(profile: p) } label: { VStack(alignment: .leading) { Text("\(p.reference) · \(p.name)"); Text("\(p.kind) · \(p.status) · \(p.photo_count)").font(.caption).foregroundStyle(.secondary) } } }
            if profiles.isEmpty { Text(api.t("No enrolled profiles", "登録情報はありません")) }
        }.navigationTitle(api.t("Enrollment", "登録")).toolbar { Button { enrolling = true } label: { Image(systemName: "plus") } }
            .sheet(isPresented: $enrolling, onDismiss: { Task { await load() } }) { EnrollmentView() }
            .task { await load() }.refreshable { await load() }
        }
    }
}
struct EnrollmentView: View {
    @EnvironmentObject var api: API
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "staff"
    @State private var reference = ""
    @State private var name = ""
    @State private var basis = ""
    @State private var expires = Date().addingTimeInterval(90*86400)
    @State private var error = ""
    @State private var busy = false
    func submit() async {
        busy = true; defer { busy = false }
        do {
            let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "yyyy-MM-dd"
            _ = try await api.bytes("/api/profiles", method: "POST", payload: ["kind":kind,"reference":reference,"name":name,"basis":basis,"expires":f.string(from: expires)]); dismiss()
        } catch { self.error = error.localizedDescription }
    }
    var body: some View {
        NavigationStack { Form {
            Picker(api.t("Type", "種別"), selection: $kind) { Text(api.t("Staff", "スタッフ")).tag("staff"); Text(api.t("Watchlist subject", "登録対象者")).tag("watchlist") }
            TextField(api.t("Reference ID", "管理番号"), text: $reference)
            TextField(api.t("Display name / label", "表示名・管理用名称"), text: $name)
            TextField(api.t("Evidence basis / photo notice", "根拠・写真利用説明"), text: $basis, axis: .vertical)
            DatePicker(api.t("Expiry", "有効期限"), selection: $expires, in: Date()..., displayedComponents: .date)
            Text(api.t("Creates a pending-review record. This reference does not approve biometric enrollment.", "確認待ちの記録として登録します。参照クライアントは生体情報登録を承認しません。")).font(.caption)
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }.navigationTitle(api.t("Enroll", "登録")).toolbar { ToolbarItem(placement: .cancellationAction) { Button(api.t("Cancel", "キャンセル")) { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button(api.t("Save", "保存")) { Task { await submit() } }.disabled(busy || reference.isEmpty || name.isEmpty || basis.isEmpty) } } }
    }
}
struct ProfileDetail: View {
    @EnvironmentObject var api: API
    let profile: Profile
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var images: [Data] = []
    @State private var error = ""
    @State private var busy = false
    func loadPhotos() async {
        do { let r: Items<PhotoRecord> = try await api.get("/api/profiles/\(profile.id)/photos", as: Items<PhotoRecord>.self); var newImages: [Data] = []; for photo in r.items { newImages.append(try await api.bytes("/api/photos/\(photo.id)")) }; images = newImages; error = "" } catch { self.error = error.localizedDescription }
    }
    func upload() async {
        guard let selectedPhoto else { return }; busy = true; defer { busy = false }
        do {
            guard let original = try await selectedPhoto.loadTransferable(type: Data.self), let image = UIImage(data: original), let data = image.jpegData(compressionQuality: 0.85), data.count <= 5*1024*1024 else { throw ServiceError(message: api.t("Invalid photo or over 5 MB", "写真が無効、または5MBを超えています")) }
            _ = try await api.bytes("/api/profiles/\(profile.id)/photos", method: "POST", payload: ["filename":"reference.jpg","data_base64":data.base64EncodedString()]); await loadPhotos()
        } catch { self.error = error.localizedDescription }
    }
    var body: some View {
        Form {
            Section { Text(profile.name).font(.headline); LabeledContent(api.t("Reference", "管理番号"), value: profile.reference); LabeledContent(api.t("Status", "状態"), value: profile.status); Text(profile.basis); Text(profile.expires) }
            Section(api.t("Reference photos", "登録写真")) {
                ScrollView(.horizontal) { HStack { ForEach(images.indices, id: \.self) { i in if let image = UIImage(data: images[i]) { Image(uiImage: image).resizable().scaledToFill().frame(width: 110,height: 110).clipped().clipShape(RoundedRectangle(cornerRadius: 12)) } } } }
                PhotosPicker(selection: $selectedPhoto, matching: .images) { Label(api.t("Upload photo", "写真を追加"), systemImage: "photo.badge.plus") }.disabled(busy)
                Text(api.t("Face quality is not evaluated in this reference. Use synthetic photos.", "この参照クライアントでは顔品質を評価しません。架空の写真を使用してください。")).font(.caption)
            }
            if !error.isEmpty { Text(error).foregroundStyle(.red) }
        }.navigationTitle(api.t("Profile", "プロフィール")).task { await loadPhotos() }.onChange(of: selectedPhoto) { _, _ in Task { await upload() } }
    }
}
struct SettingsView: View {
    @EnvironmentObject var api: API
    var body: some View {
        NavigationStack { Form {
            Toggle("日本語", isOn: $api.japanese)
            LabeledContent(api.t("Service origin", "接続先"), value: api.origin)
            Section { Text(api.t("Production APNs, live evidence and biometric search require the implementation milestones in the package.", "製品版APNs・証拠動画・生体情報検索は、同梱の実装工程に従って開発してください。")).font(.caption) }
            Button(api.t("Sign out", "ログアウト"), role: .destructive) { Task { await api.signOut() } }
        }.navigationTitle(api.t("Settings", "設定")) }
    }
}
