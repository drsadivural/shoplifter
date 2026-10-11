import Foundation
import Observation
import SwiftUI

enum AppearancePreference: String, CaseIterable, Identifiable, Codable {
    case system, light, dark

    var id: String { rawValue }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }

    var title: String {
        switch self {
        case .system: return L("Match system")
        case .light: return L("Light")
        case .dark: return L("Dark")
        }
    }
}

/// Device-local, non-sensitive preferences. Tokens never go here (Keychain only).
@MainActor
@Observable
final class AppPreferences {
    private let defaults: UserDefaults

    var language: AppLanguage {
        didSet {
            defaults.set(language.rawValue, forKey: Keys.language)
            Localizer.apply(language)
            // Also steer the system-resolved language (permission prompts,
            // InfoPlist strings) for the next launch.
            if let code = language.serverLocale {
                defaults.set([code], forKey: "AppleLanguages")
            } else {
                defaults.removeObject(forKey: "AppleLanguages")
            }
        }
    }

    var appearance: AppearancePreference {
        didSet { defaults.set(appearance.rawValue, forKey: Keys.appearance) }
    }

    /// The user opted into Face ID app unlock on this device.
    var faceIDEnabled: Bool {
        didSet { defaults.set(faceIDEnabled, forKey: Keys.faceIDEnabled) }
    }

    /// The Face ID onboarding (ios-04) has been answered (enable or later).
    var faceIDPromptAnswered: Bool {
        didSet { defaults.set(faceIDPromptAnswered, forKey: Keys.faceIDPrompted) }
    }

    /// The notification onboarding (ios-05) has been answered.
    var notificationPromptAnswered: Bool {
        didSet { defaults.set(notificationPromptAnswered, forKey: Keys.notificationPrompted) }
    }

    /// Normalized API origin chosen on the welcome screen.
    var workspaceOrigin: String? {
        didSet { defaults.set(workspaceOrigin, forKey: Keys.workspace) }
    }

    /// Last signed-in email (prefill only; never the password).
    var lastEmail: String? {
        didSet { defaults.set(lastEmail, forKey: Keys.lastEmail) }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let language = AppLanguage(rawValue: defaults.string(forKey: Keys.language) ?? "") ?? .system
        self.language = language
        appearance = AppearancePreference(rawValue: defaults.string(forKey: Keys.appearance) ?? "") ?? .system
        faceIDEnabled = defaults.bool(forKey: Keys.faceIDEnabled)
        faceIDPromptAnswered = defaults.bool(forKey: Keys.faceIDPrompted)
        notificationPromptAnswered = defaults.bool(forKey: Keys.notificationPrompted)
        workspaceOrigin = defaults.string(forKey: Keys.workspace)
        lastEmail = defaults.string(forKey: Keys.lastEmail)
        Localizer.apply(language)
    }

    func selectedStoreId(for userId: String) -> String? {
        defaults.string(forKey: Keys.selectedStore + "." + userId)
    }

    func setSelectedStoreId(_ storeId: String?, for userId: String) {
        defaults.set(storeId, forKey: Keys.selectedStore + "." + userId)
    }

    var lastPushRegistration: String? {
        get { defaults.string(forKey: Keys.pushRegistration) }
        set { defaults.set(newValue, forKey: Keys.pushRegistration) }
    }

    var pushDeviceId: String? {
        get { defaults.string(forKey: Keys.pushDeviceId) }
        set { defaults.set(newValue, forKey: Keys.pushDeviceId) }
    }

    /// Clears account-bound state on sign-out (keeps language/appearance).
    func resetForSignOut() {
        faceIDEnabled = false
        faceIDPromptAnswered = false
        lastPushRegistration = nil
        pushDeviceId = nil
    }

    private enum Keys {
        static let language = "rg.language"
        static let appearance = "rg.appearance"
        static let faceIDEnabled = "rg.faceid.enabled"
        static let faceIDPrompted = "rg.faceid.prompted"
        static let notificationPrompted = "rg.notifications.prompted"
        static let workspace = "rg.workspace.origin"
        static let lastEmail = "rg.last.email"
        static let selectedStore = "rg.selected.store"
        static let pushRegistration = "rg.push.registration"
        static let pushDeviceId = "rg.push.deviceId"
    }
}
