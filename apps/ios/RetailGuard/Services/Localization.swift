import Foundation

/// In-app language override: follow the system, or force English / 日本語.
enum AppLanguage: String, CaseIterable, Identifiable, Codable {
    case system
    case english = "en"
    case japanese = "ja"

    var id: String { rawValue }

    /// Name shown in the picker, always in its own language so a user who
    /// cannot read the current language can still find theirs.
    var nativeName: String {
        switch self {
        case .system: return L("System language")
        case .english: return "English"
        case .japanese: return "日本語"
        }
    }

    /// Locale code sent to the server (`PATCH /v1/me/preferences {locale}`).
    var serverLocale: String? {
        switch self {
        case .system: return nil
        case .english: return "en"
        case .japanese: return "ja"
        }
    }
}

/// Resolves strings from `Localizable.xcstrings` honouring the in-app
/// override. Keys are the English source strings; a missing translation falls
/// back to the key itself (English).
enum Localizer {
    nonisolated(unsafe) private static var bundle: Bundle = .main
    nonisolated(unsafe) private(set) static var language: AppLanguage = .system
    private static let lock = NSLock()

    static func apply(_ language: AppLanguage) {
        lock.lock(); defer { lock.unlock() }
        self.language = language
        if let code = language.serverLocale,
           let path = Bundle.main.path(forResource: code, ofType: "lproj"),
           let languageBundle = Bundle(path: path) {
            bundle = languageBundle
        } else {
            bundle = .main
        }
    }

    static func string(_ key: String) -> String {
        lock.lock()
        let current = bundle
        lock.unlock()
        return current.localizedString(forKey: key, value: key, table: "Localizable")
    }

    /// Effective language code of the resolved bundle ("en" or "ja").
    static var effectiveLanguageCode: String {
        if let code = language.serverLocale { return code }
        let preferred = Bundle.main.preferredLocalizations.first ?? "en"
        return preferred.hasPrefix("ja") ? "ja" : "en"
    }

    /// Locale used for date/number formatting in the UI.
    static var locale: Locale {
        switch language {
        case .system: return .autoupdatingCurrent
        case .english: return Locale(identifier: "en_US")
        case .japanese: return Locale(identifier: "ja_JP")
        }
    }
}

/// Localized string for a literal English key.
func L(_ key: String) -> String {
    Localizer.string(key)
}

/// Localized format string (`%@` placeholders) with arguments.
func LF(_ key: String, _ arguments: CVarArg...) -> String {
    String(format: Localizer.string(key), locale: Localizer.locale, arguments: arguments)
}
