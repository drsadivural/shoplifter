import Foundation
import Observation
import UIKit
import UserNotifications
import RetailGuardCore

/// Notification permission + APNs device-token registration
/// (`POST /v1/push/devices`). Push is only a hint: the inbox is always
/// fetched from the API and acknowledgement is never inferred from delivery.
@MainActor
@Observable
final class PushManager {
    enum Registration: Equatable {
        case notRegistered
        case registering
        case registered(deviceId: String)
        /// 503 `push_unconfigured`: the organization has no APNs provider yet.
        case serverUnconfigured
        case failed(String)
    }

    static let incidentCategory = "RG_INCIDENT"

    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var registration: Registration = .notRegistered
    private(set) var apnsToken: String?

    private let config: AppConfig
    private let preferences: AppPreferences
    @ObservationIgnored private weak var appState: AppState?

    init(config: AppConfig, preferences: AppPreferences) {
        self.config = config
        self.preferences = preferences
    }

    func attach(_ appState: AppState) {
        self.appState = appState
    }

    /// Lock-screen privacy: if the user hides previews, iOS shows this generic
    /// placeholder. Payloads themselves never contain faces or accusations.
    func configureCategories() {
        let category = UNNotificationCategory(
            identifier: Self.incidentCategory,
            actions: [],
            intentIdentifiers: [],
            hiddenPreviewsBodyPlaceholder: L("New RetailGuard alert"),
            options: [.hiddenPreviewsShowTitle]
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorization = settings.authorizationStatus
    }

    /// Shows the system prompt (ios-05). Returns whether alerts are allowed.
    @discardableResult
    func requestAuthorization() async -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            await refreshAuthorization()
            if granted { UIApplication.shared.registerForRemoteNotifications() }
            return granted
        } catch {
            await refreshAuthorization()
            return false
        }
    }

    /// Re-registers on every launch/sign-in when permission was granted; APNs
    /// tokens can rotate.
    func registerIfAuthorized() async {
        await refreshAuthorization()
        switch authorization {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        default:
            break
        }
    }

    func didRegister(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        apnsToken = hex
        Task { await uploadToken() }
    }

    func didFailToRegister(_ error: Error) {
        registration = .failed(error.localizedDescription)
    }

    /// Sends the token for the signed-in user. Skipped when the same
    /// user+token+environment was already registered.
    func uploadToken() async {
        guard let appState, let token = apnsToken, let userId = appState.me?.user.id else { return }
        let marker = "\(userId)|\(token)|\(config.apnsEnvironment.rawValue)"
        if preferences.lastPushRegistration == marker, let id = preferences.pushDeviceId {
            registration = .registered(deviceId: id)
            return
        }
        registration = .registering
        do {
            let response = try await appState.api.registerPushDevice(
                PushDeviceRequest(token: token, environment: config.apnsEnvironment, bundleId: config.bundleIdentifier))
            preferences.pushDeviceId = response.id
            preferences.lastPushRegistration = marker
            registration = .registered(deviceId: response.id)
        } catch let error as APIError where error.code == APIErrorCode.pushUnconfigured {
            registration = .serverUnconfigured
        } catch {
            registration = .failed(appState.present(error).message)
        }
    }

    /// Removes the device registration on sign-out so the signed-out device
    /// stops receiving this user's notices.
    func unregister() async {
        guard let appState, let id = preferences.pushDeviceId else { return }
        try? await appState.api.unregisterPushDevice(id: id)
        preferences.pushDeviceId = nil
        preferences.lastPushRegistration = nil
        registration = .notRegistered
    }

    func clearBadge() {
        UNUserNotificationCenter.current().setBadgeCount(0)
    }
}
