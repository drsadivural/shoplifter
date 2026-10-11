import SwiftUI
import UIKit
import UserNotifications
import RetailGuardCore

private struct FeatureRow: View {
    let systemImage: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(Color.rgPrimary)
                .frame(width: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline).foregroundStyle(Color.rgInk)
                Text(detail).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// ios-04 — Enable Face ID for app unlock. Biometrics are processed by iOS on
/// the device and only unlock the retained session; this is unrelated to the
/// store's face matching and never enrolls the user anywhere.
struct FaceIDSetupView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.openURL) private var openURL
    @State private var busy = false
    @State private var message: String?

    var body: some View {
        let availability = BiometricAuth.availability()
        let kind = Self.kind(availability)
        AuthScaffold(title: LF("Enable %@", kind.displayName),
                     subtitle: L("Unlock RetailGuard quickly without retyping your password.")) {
            FeatureRow(systemImage: kind.systemImage, title: L("Unlock securely"),
                       detail: L("Your session stays in this device's Keychain and opens only after you unlock."))
            FeatureRow(systemImage: "iphone.gen3", title: L("Device-only biometrics"),
                       detail: L("iOS checks your face on this device. RetailGuard never receives biometric data, and this is not store face matching."))
            switch availability {
            case .available:
                Button {
                    Task { await enable() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(Color.rgOnPrimary) }
                        Text(LF("Enable %@", kind.displayName))
                    }
                }
                .buttonStyle(.rgPrimary)
                .disabled(busy)
            case .notEnrolled:
                InfoBanner(text: LF("%@ is not set up on this device. You can set it up in Settings and turn it on later in Account & security.", kind.displayName),
                           tone: .info, systemImage: "info.circle")
            case .denied:
                InfoBanner(text: LF("RetailGuard is not allowed to use %@. You can allow it in Settings; password sign-in keeps working.", kind.displayName),
                           tone: .warning)
                Button(L("Open Settings")) {
                    if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.rgSecondary)
            case .lockedOut:
                InfoBanner(text: LF("%@ is locked after failed attempts. Unlock your iPhone with its passcode, then try again later.", kind.displayName),
                           tone: .warning)
            case .unavailable:
                InfoBanner(text: L("Biometric unlock is not available on this device. You will sign in with your password."),
                           tone: .info, systemImage: "info.circle")
            }
            if let message { InfoBanner(text: message, tone: .warning) }
            Button(L("Later")) {
                Task { await appState.finishFaceIDOnboarding(enabled: false) }
            }
            .buttonStyle(.rgSecondary)
        }
    }

    static func kind(_ availability: BiometricAuth.Availability) -> BiometricAuth.Kind {
        switch availability {
        case .available(let kind), .notEnrolled(let kind), .denied(let kind), .lockedOut(let kind):
            return kind == .none ? .faceID : kind
        case .unavailable:
            return .faceID
        }
    }

    private func enable() async {
        busy = true
        defer { busy = false }
        switch await BiometricAuth.authenticate(reason: L("Confirm to use biometric unlock for RetailGuard")) {
        case .success:
            await appState.finishFaceIDOnboarding(enabled: true)
        case .failure(.cancelled):
            message = nil
        case .failure(.fallbackToPassword), .failure(.unavailable):
            message = L("Biometric unlock was not turned on. You will sign in with your password.")
        case .failure(.failed):
            message = L("Verification failed. Try again or choose Later.")
        }
    }
}

/// ios-05 — Notification permission with lock-screen privacy explanation.
struct NotificationPermissionView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.openURL) private var openURL
    @State private var busy = false

    var body: some View {
        AuthScaffold(title: L("Enable notifications"),
                     subtitle: L("Get notified when an alert in your assigned stores needs review.")) {
            FeatureRow(systemImage: "bell.badge", title: L("Incident alerts"),
                       detail: L("Alerts for the stores and alert types you choose. Always check the app for the current state."))
            FeatureRow(systemImage: "lock.iphone", title: L("Private lock-screen text"),
                       detail: L("Notifications only say that an alert needs review. They never include photos, names or accusations."))
            if appState.push.authorization == .denied {
                InfoBanner(text: L("Notifications are turned off for RetailGuard. You can turn them on in Settings. Alerts remain available in the app."),
                           tone: .warning)
                Button(L("Open Settings")) {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                }
                .buttonStyle(.rgSecondary)
            } else {
                Button {
                    Task {
                        busy = true
                        await appState.finishNotificationOnboarding(requested: true)
                        busy = false
                    }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(Color.rgOnPrimary) }
                        Text(L("Enable notifications"))
                    }
                }
                .buttonStyle(.rgPrimary)
                .disabled(busy)
            }
            Button(L("Later")) {
                Task { await appState.finishNotificationOnboarding(requested: false) }
            }
            .buttonStyle(.rgSecondary)
        }
        .task { await appState.push.refreshAuthorization() }
    }
}

/// App lock shown when Face ID unlock is enabled and a session is retained.
struct LockedView: View {
    @Environment(AppState.self) private var appState
    @State private var message: String?
    @State private var busy = false

    var body: some View {
        let kind = FaceIDSetupView.kind(BiometricAuth.availability())
        AuthScaffold(title: L("RetailGuard is locked"), subtitle: L("Unlock to continue to your assigned stores.")) {
            Button {
                Task { await unlock() }
            } label: {
                Label(LF("Unlock with %@", kind.displayName), systemImage: kind.systemImage)
            }
            .buttonStyle(.rgPrimary)
            .disabled(busy)
            if let message { InfoBanner(text: message, tone: .warning) }
            Button(L("Sign in with password")) {
                Task { await appState.signOut(keepDrafts: true, remote: false) }
            }
            .buttonStyle(.rgSecondary)
        }
        .task { await unlock() }
    }

    private func unlock() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        switch await appState.unlockWithBiometrics() {
        case nil, .cancelled?:
            message = nil
        case .failed?:
            message = L("Verification failed. Try again or sign in with your password.")
        case .fallbackToPassword?, .unavailable?:
            message = nil
        }
    }
}

/// ios-33 — Session expired. Drafts stay on the device and will be checked
/// against the latest incident before submission.
struct SessionExpiredView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        AuthScaffold(title: L("Session expired"),
                     subtitle: L("For security, your session ended. Sign in again to continue.")) {
            let drafts = appState.retainedSession?.userId.map { appState.drafts.drafts(for: $0) } ?? []
            VStack(alignment: .leading, spacing: 8) {
                Text(L("Unsaved draft")).font(.headline)
                if drafts.isEmpty {
                    Text(L("No unsent drafts on this device."))
                        .font(.subheadline).foregroundStyle(Color.rgSecondaryText)
                } else {
                    Text(LF("%@ outcome draft(s) are kept on this device. After you sign in, each is refreshed against the current incident before it can be submitted.", String(drafts.count)))
                        .font(.subheadline).foregroundStyle(Color.rgSecondaryText)
                    ForEach(drafts) { draft in
                        Label(draft.incidentRef, systemImage: "doc.badge.clock")
                            .font(.subheadline)
                    }
                }
            }
            Button(L("Sign in again")) { appState.goToLogin() }
                .buttonStyle(.rgPrimary)
            CompanySSONotice()
        }
        .task { if appState.authConfig == nil { await appState.loadAuthConfig() } }
    }
}
