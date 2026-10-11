import SwiftUI
import RetailGuardCore

/// ios-29 — Account & security: Face ID, active sessions, language,
/// appearance and sign-out.
struct AccountView: View {
    @Environment(AppState.self) private var appState
    @State private var sessions: Loadable<[UserSession]> = .idle
    @State private var confirmSignOut = false
    @State private var faceIDMessage: String?
    @State private var prefError: UserFacingError?
    @State private var revoking: String?

    var body: some View {
        ScreenScaffold(title: L("Account & security"), showsStoreSubtitle: false) {
            if let me = appState.me {
                accountCard(me)
            }
            securityCard
            sessionsCard
            displayCard
            linksCard
            Button(L("Sign out"), role: .destructive) { confirmSignOut = true }
                .buttonStyle(.rgDestructive)
            Text(LF("Version %@ (%@) · %@", appState.config.appVersion, appState.config.buildNumber, appState.workspaceDisplay))
                .font(.caption)
                .foregroundStyle(Color.rgSecondaryText)
        }
        .refreshable { await loadSessions() }
        .task { if case .idle = sessions { await loadSessions() } }
        .confirmationDialog(L("Sign out of RetailGuard?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button(L("Sign out"), role: .destructive) { Task { await appState.signOut() } }
        } message: {
            Text(L("Signing out removes the session, unsent drafts and push registration from this device."))
        }
    }

    private func accountCard(_ me: Me) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(me.user.displayName).font(.title3.bold())
            Text(me.user.email).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            KeyValueRow(label: L("Role"), value: me.user.role.title)
            KeyValueRow(label: L("Organization"), value: me.org.name)
            KeyValueRow(label: L("Two-step verification"), value: me.user.mfaEnabled ? L("On") : L("Off"),
                        valueTone: me.user.mfaEnabled ? .success : .warning)
            Button {
                appState.open(.storeSelection, in: .account)
            } label: {
                HStack {
                    Text(L("Store")).foregroundStyle(Color.rgSecondaryText)
                    Spacer()
                    Text(appState.storeTitle).foregroundStyle(Color.rgInk)
                    Image(systemName: "chevron.right").font(.caption)
                }
                .font(.subheadline)
                .rgTapTarget()
            }
            .buttonStyle(.plain)
        }
        .rgCard()
    }

    private var securityCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Face ID"))
            let availability = BiometricAuth.availability()
            let kind = FaceIDSetupView.kind(availability)
            switch availability {
            case .available:
                Toggle(LF("Unlock with %@", kind.displayName), isOn: Binding(
                    get: { appState.preferences.faceIDEnabled },
                    set: { newValue in Task { await setFaceID(newValue) } }))
                    .tint(Color.rgPrimary)
            case .notEnrolled:
                FieldHint(text: LF("%@ is not set up on this device.", kind.displayName))
            case .denied:
                FieldHint(text: LF("RetailGuard is not allowed to use %@. Password sign-in keeps working.", kind.displayName))
            case .lockedOut:
                FieldHint(text: LF("%@ is locked after failed attempts. Unlock your iPhone with its passcode, then try again later.", kind.displayName))
            case .unavailable:
                FieldHint(text: L("Biometric unlock is not available on this device. You will sign in with your password."))
            }
            FieldHint(text: L("Device-only biometrics: iOS checks your face on this device. RetailGuard never receives biometric data, and this is not store face matching."))
            if let faceIDMessage { FieldHint(text: faceIDMessage) }
        }
        .rgCard()
    }

    private var sessionsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Active sessions"))
            switch sessions {
            case .idle, .loading:
                ProgressView()
            case .failed(let failure):
                FieldHint(text: failure.message)
                Button(L("Retry")) { Task { await loadSessions() } }.buttonStyle(.rgSecondary)
            case .loaded(let items):
                if items.isEmpty { FieldHint(text: L("No active sessions.")) }
                ForEach(items) { session in
                    HStack(alignment: .top) {
                        Image(systemName: session.client == "ios" ? "iphone" : "desktopcomputer")
                            .foregroundStyle(Color.rgPrimary)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.current ? L("This device") : (session.userAgent ?? session.client ?? L("Session")))
                                .font(.subheadline.weight(.semibold))
                                .lineLimit(2)
                            if let seen = session.lastSeenAt {
                                Text(LF("Last active %@", appState.format(seen, storeId: nil)))
                                    .font(.caption).foregroundStyle(Color.rgSecondaryText)
                            }
                        }
                        Spacer()
                        if !session.current {
                            Button(L("Revoke"), role: .destructive) { Task { await revoke(session) } }
                                .font(.subheadline)
                                .rgTapTarget()
                                .disabled(revoking == session.id)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .rgCard()
    }

    private var displayCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Display"))
            Picker(L("Language"), selection: Binding(get: { appState.preferences.language },
                                                    set: { newValue in Task { await setLanguage(newValue) } })) {
                ForEach(AppLanguage.allCases) { Text($0.nativeName).tag($0) }
            }
            Picker(L("Appearance"), selection: Binding(get: { appState.preferences.appearance },
                                                      set: { newValue in Task { await setAppearance(newValue) } })) {
                ForEach(AppearancePreference.allCases) { Text($0.title).tag($0) }
            }
            if let prefError { FieldHint(text: prefError.message) }
        }
        .rgCard()
    }

    private var linksCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            link(L("Notification preferences"), "bell.badge", .notificationSettings)
            link(L("Response team"), "person.3", .team)
            link(L("Help & diagnostics"), "questionmark.circle", .help)
            link(L("Offline mode"), "arrow.triangle.2.circlepath", .offline)
        }
        .rgCard()
    }

    private func link(_ title: String, _ icon: String, _ route: Route) -> some View {
        Button {
            appState.open(route, in: .account)
        } label: {
            HStack {
                Label(title, systemImage: icon).foregroundStyle(Color.rgInk)
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.rgSecondaryText)
            }
            .rgTapTarget()
        }
        .buttonStyle(.plain)
    }

    private func setFaceID(_ enabled: Bool) async {
        guard enabled else {
            appState.preferences.faceIDEnabled = false
            faceIDMessage = nil
            return
        }
        switch await BiometricAuth.authenticate(reason: L("Confirm to use biometric unlock for RetailGuard")) {
        case .success:
            appState.preferences.faceIDEnabled = true
            appState.preferences.faceIDPromptAnswered = true
            faceIDMessage = nil
        case .failure(.cancelled):
            faceIDMessage = nil
        case .failure:
            faceIDMessage = L("Biometric unlock was not turned on. You will sign in with your password.")
        }
    }

    /// Applies locally at once; also saved to the account when a specific
    /// language is chosen (the server has no "system" value).
    private func setLanguage(_ language: AppLanguage) async {
        appState.preferences.language = language
        appState.api.setAcceptLanguage(Localizer.effectiveLanguageCode)
        guard let locale = language.serverLocale else { return }
        do {
            _ = try await appState.api.updatePreferences(PreferencesUpdate(locale: locale))
            prefError = nil
        } catch {
            prefError = appState.present(error)
        }
    }

    private func setAppearance(_ appearance: AppearancePreference) async {
        appState.preferences.appearance = appearance
        let theme: ThemePreference = appearance == .light ? .light : appearance == .dark ? .dark : .system
        do {
            _ = try await appState.api.updatePreferences(PreferencesUpdate(theme: theme))
            prefError = nil
        } catch {
            prefError = appState.present(error)
        }
    }

    private func loadSessions() async {
        sessions = .loading
        do {
            sessions = .loaded(try await appState.api.sessions())
        } catch {
            sessions = .failed(appState.present(error))
        }
    }

    private func revoke(_ session: UserSession) async {
        revoking = session.id
        defer { revoking = nil }
        do {
            try await appState.api.revokeSession(id: session.id)
            await loadSessions()
        } catch {
            sessions = .failed(appState.present(error))
        }
    }
}
