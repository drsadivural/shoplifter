import SwiftUI
import UIKit
import UserNotifications
import RetailGuardCore

/// ios-28 — Notification preferences (`PATCH /v1/me/preferences`), plus the
/// device's iOS permission and APNs registration status.
struct NotificationPreferencesView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.openURL) private var openURL

    @State private var prefs: NotificationPrefs?
    @State private var original: NotificationPrefs?
    @State private var quietEnabled = false
    @State private var quietStart = Date()
    @State private var quietEnd = Date()
    @State private var storeIds: Set<String> = []
    @State private var busy = false
    @State private var message: String?
    @State private var error: UserFacingError?
    @State private var errors: [String: String] = [:]

    var body: some View {
        ScreenScaffold(title: L("Notification preferences"), showsStoreSubtitle: false) {
            deviceStatus
            if prefs != nil {
                editor
            } else if let error {
                FailureStateView(error: error) { loadFromMe() }
            } else {
                LoadingStateView()
            }
        }
        .task {
            await appState.push.refreshAuthorization()
            loadFromMe()
        }
    }

    // MARK: Device status

    private var deviceStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("This device"))
            switch appState.push.authorization {
            case .authorized, .provisional, .ephemeral:
                Label(L("Notifications allowed"), systemImage: "bell.badge").foregroundStyle(Color.rgSuccess)
            case .denied:
                Label(L("Notifications are off for RetailGuard"), systemImage: "bell.slash").foregroundStyle(Color.rgWarning)
                Button(L("Open Settings")) {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.rgSecondary)
            case .notDetermined:
                Button(L("Enable notifications")) {
                    Task { await appState.push.requestAuthorization() }
                }
                .buttonStyle(.rgPrimary)
            default:
                EmptyView()
            }
            switch appState.push.registration {
            case .registered:
                FieldHint(text: L("Push delivery registered for this device."))
            case .serverUnconfigured:
                FieldHint(text: AppState.unavailableMessage(APIErrorCode.pushUnconfigured))
            case .failed(let reason):
                FieldHint(text: LF("Push registration failed: %@", reason))
            case .registering:
                ProgressView()
            case .notRegistered:
                EmptyView()
            }
            FieldHint(text: L("Push is a hint only. Always open the app to see the current state; delivery is not guaranteed."))
        }
        .rgCard()
    }

    // MARK: Editor

    @ViewBuilder private var editor: some View {
        if let binding = Binding($prefs) {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: L("Stores"))
                StoreMultiSelect(stores: appState.me?.stores ?? [], selection: $storeIds)
                FieldHint(text: L("No selection means all of your assigned stores."))
            }
            .rgCard()

            VStack(alignment: .leading, spacing: 4) {
                SectionTitle(text: L("Types"))
                Toggle(L("Behavior alerts"), isOn: binding.behavior)
                Toggle(L("Watchlist alerts"), isOn: binding.watchlist)
                Toggle(L("Checkout alerts"), isOn: binding.checkout)
                Toggle(L("RFID alerts"), isOn: binding.rfid)
            }
            .tint(Color.rgPrimary)
            .rgCard()

            VStack(alignment: .leading, spacing: 8) {
                Toggle(L("Sound"), isOn: binding.sound).tint(Color.rgPrimary)
                Toggle(L("Quiet hours"), isOn: $quietEnabled).tint(Color.rgPrimary)
                if quietEnabled {
                    DatePicker(L("Start"), selection: $quietStart, displayedComponents: .hourAndMinute)
                    DatePicker(L("End"), selection: $quietEnd, displayedComponents: .hourAndMinute)
                    FieldHint(text: L("Quiet hours use each store's local time."))
                }
                FieldError(text: errors["quiet_hours"])
            }
            .rgCard()

            VStack(alignment: .leading, spacing: 4) {
                SectionTitle(text: L("Private preview"))
                KeyValueRow(label: L("Private lock-screen text"), value: L("Always on"), valueTone: .success)
                FieldHint(text: L("Notifications only say an alert needs review. Photos, names and accusations are never sent to the lock screen."))
            }
            .rgCard()

            if let message { InfoBanner(text: message, tone: .success, systemImage: "checkmark.circle") }
            if let error { ErrorBanner(error: error) }
            HStack {
                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(Color.rgOnPrimary) }
                        Text(L("Save"))
                    }
                }
                .buttonStyle(.rgPrimary)
                .disabled(busy)
                Button(L("Cancel")) { loadFromMe() }
                    .buttonStyle(.rgSecondary)
            }
        }
    }

    private func loadFromMe() {
        guard let me = appState.me else {
            error = UserFacingError(kind: .server, message: L("Account details are not loaded."), requestId: nil)
            return
        }
        let current = me.user.notificationPrefs ?? NotificationPrefs(behavior: true, watchlist: true, checkout: true, rfid: true,
                                                                       sound: true, quietHours: nil, storeIds: [])
        prefs = current
        original = current
        storeIds = Set(current.storeIds)
        quietEnabled = current.quietHours != nil
        let calendar = Calendar.current
        func date(_ string: String?, fallbackHour: Int) -> Date {
            let parts = string.flatMap(StoreTime.components(fromHourMinute:)) ?? DateComponents(hour: fallbackHour, minute: 0)
            return calendar.date(bySettingHour: parts.hour ?? fallbackHour, minute: parts.minute ?? 0, second: 0, of: Date()) ?? Date()
        }
        quietStart = date(current.quietHours?.start, fallbackHour: 22)
        quietEnd = date(current.quietHours?.end, fallbackHour: 7)
        message = nil
        error = nil
    }

    private func save() async {
        guard var updated = prefs else { return }
        errors = [:]
        if quietEnabled {
            let calendar = Calendar.current
            guard let start = StoreTime.hourMinute(from: calendar.dateComponents([.hour, .minute], from: quietStart)),
                  let end = StoreTime.hourMinute(from: calendar.dateComponents([.hour, .minute], from: quietEnd)),
                  start != end else {
                errors["quiet_hours"] = L("Start and end must be different.")
                return
            }
            updated.quietHours = QuietHours(start: start, end: end)
        } else {
            updated.quietHours = nil
        }
        updated.storeIds = Array(storeIds).sorted()
        updated.privatePreview = true
        busy = true
        defer { busy = false }
        do {
            _ = try await appState.api.updatePreferences(PreferencesUpdate(notificationPrefs: updated))
            await appState.refreshMe()
            loadFromMe()
            message = L("Notification preferences saved.")
        } catch {
            self.error = appState.present(error)
        }
    }
}
