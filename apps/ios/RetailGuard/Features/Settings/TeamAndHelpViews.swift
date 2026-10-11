import SwiftUI
import UIKit
import UserNotifications
import RetailGuardCore

/// ios-30 — Response team for the selected store (`GET /v1/team`). No phone
/// numbers or personal contact details are exposed in the app.
struct TeamView: View {
    @Environment(AppState.self) private var appState
    @State private var state: Loadable<[TeamMember]> = .idle
    @State private var store: Store?

    var body: some View {
        ScreenScaffold(title: L("Response team")) {
            LoadableView(state: state, retry: load) { members in
                if let manager = store?.managerName, !manager.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        SectionTitle(text: L("Store manager"))
                        Label(manager, systemImage: "person.crop.circle.badge.checkmark")
                    }
                    .rgCard()
                }
                if members.isEmpty {
                    EmptyStateView(systemImage: "person.3", title: L("No team members"),
                                   message: L("No responders or administrators have access to this store."))
                } else {
                    let onDuty = members.filter(\.onDuty)
                    let offDuty = members.filter { !$0.onDuty }
                    section(L("On duty"), onDuty, tone: .success)
                    if !offDuty.isEmpty { section(L("Off duty"), offDuty, tone: .neutral) }
                }
                InfoBanner(text: L("Contact via approved channel: use your organization's approved radio, phone or messaging channel. RetailGuard does not share personal contact details."),
                           tone: .info, systemImage: "bubble.left.and.exclamationmark.bubble.right")
            }
        }
        .refreshable { await load() }
        .task(id: appState.selectedStoreId) { await load() }
    }

    private func section(_ title: String, _ members: [TeamMember], tone: Tone) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: title)
            if members.isEmpty { FieldHint(text: L("No one is marked on duty.")) }
            ForEach(members) { member in
                HStack {
                    Image(systemName: "person.crop.circle").foregroundStyle(Color.rgPrimary).accessibilityHidden(true)
                    VStack(alignment: .leading) {
                        Text(member.id == appState.userId ? LF("%@ (you)", member.displayName) : member.displayName)
                            .font(.subheadline.weight(.semibold))
                        Text(member.role.title).font(.caption).foregroundStyle(Color.rgSecondaryText)
                    }
                    Spacer()
                    StatusBadge(text: member.onDuty ? L("On duty") : L("Off duty"),
                                systemImage: member.onDuty ? "checkmark.circle" : "moon", tone: tone)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .rgCard()
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            async let members = appState.api.team(storeId: appState.selectedStoreId)
            if let storeId = appState.selectedStoreId {
                store = try? await appState.api.store(id: storeId)
            } else {
                store = nil
            }
            state = .loaded(try await members)
        } catch {
            state = .failed(appState.present(error))
        }
    }
}

/// ios-34 — Help & diagnostics: consented, redacted support bundle
/// (`POST /v1/support/bundles`) plus on-device diagnostics without secrets.
struct HelpView: View {
    @Environment(AppState.self) private var appState
    @State private var category: SupportCategory = .camera
    @State private var storeId: String?
    @State private var description = ""
    @State private var consent = false
    @State private var errors: [String: String] = [:]
    @State private var busy = false
    @State private var result: SupportBundle?
    @State private var error: UserFacingError?
    @State private var health: SystemHealth?
    @State private var initialized = false

    var body: some View {
        ScreenScaffold(title: L("Help & diagnostics"), showsStoreSubtitle: false) {
            guidance
            if appState.can(.supportCreate) {
                form
            } else {
                PermissionDeniedView(message: L("Your role cannot create support requests. Ask your store manager."))
            }
            contactCard
            diagnosticsCard
        }
        .onAppear {
            guard !initialized else { return }
            initialized = true
            storeId = appState.selectedStoreId
        }
        .task {
            await appState.push.refreshAuthorization()
            if appState.authConfig == nil { await appState.loadAuthConfig() }
            if appState.can(.healthRead) { health = try? await appState.api.systemHealth() }
        }
    }

    private var guidance: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(L("Camera issue"), systemImage: "video.slash").font(.headline)
            Text(L("Check Cameras for readiness and last frame. Offline cameras are usually a store network or appliance problem."))
                .font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            Label(L("Notification issue"), systemImage: "bell.slash").font(.headline)
            Text(L("Check Notification preferences and iOS Settings. Alerts are always available in the app even when push is delayed."))
                .font(.subheadline).foregroundStyle(Color.rgSecondaryText)
        }
        .rgCard()
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: L("Diagnostics"))
            Picker(L("Issue category"), selection: $category) {
                Text(L("Camera issue")).tag(SupportCategory.camera)
                Text(L("Notification issue")).tag(SupportCategory.notification)
                Text(L("Sign-in or access")).tag(SupportCategory.access)
                Text(L("Other")).tag(SupportCategory.other)
            }
            Picker(L("Affected store"), selection: $storeId) {
                Text(L("Not store-specific")).tag(String?.none)
                ForEach(appState.me?.stores ?? []) { Text($0.name).tag(String?.some($0.id)) }
            }
            LabeledInput(label: L("Description"), hint: L("Do not include personal data about customers."), error: errors["description"]) {
                TextField(L("Required"), text: $description, axis: .vertical)
                    .lineLimit(3...8)
                    .padding(.vertical, 8)
            }
            Toggle(L("Diagnostics consent"), isOn: $consent).tint(Color.rgPrimary)
            FieldHint(text: L("I agree to send redacted diagnostics (versions, health and error codes). No video, photos or credentials are included."))
            FieldError(text: errors["consent"])
            if let error { ErrorBanner(error: error) }
            if let result {
                VStack(alignment: .leading, spacing: 4) {
                    Label(L("Diagnostic bundle created"), systemImage: "checkmark.circle").foregroundStyle(Color.rgSuccess)
                    Text(LF("Reference: %@", result.id)).font(.caption.monospaced()).textSelection(.enabled)
                    if let expires = result.expiresAt {
                        Text(LF("Available to support until %@", appState.format(expires, storeId: storeId))).font(.caption)
                    }
                    FieldHint(text: L("Share this reference with support. The bundle itself is downloaded by authorized administrators."))
                }
            }
            Button {
                Task { await submit() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(Color.rgOnPrimary) }
                    Text(L("Generate diagnostic bundle"))
                }
            }
            .buttonStyle(.rgPrimaryWide)
            .disabled(busy)
        }
        .rgCard()
    }

    private var contactCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Contact support"))
            if let contact = appState.authConfig?.supportContact, !contact.isEmpty {
                if let url = SupportContact.url(for: contact) {
                    Link(destination: url) { Label(contact, systemImage: contact.contains("@") ? "envelope" : "link") }
                        .rgTapTarget()
                } else {
                    Text(contact).textSelection(.enabled)
                }
            } else {
                FieldHint(text: L("Your organization has not published a support contact. Ask your store manager."))
            }
        }
        .rgCard()
    }

    private var diagnosticsCard: some View {
        VStack(alignment: .leading, spacing: 2) {
            SectionTitle(text: L("This device"))
            KeyValueRow(label: L("App version"), value: "\(appState.config.appVersion) (\(appState.config.buildNumber))")
            KeyValueRow(label: L("iOS"), value: UIDevice.current.systemVersion)
            KeyValueRow(label: L("Workspace"), value: appState.workspaceDisplay)
            KeyValueRow(label: L("Network"), value: appState.network.isOnline ? L("Online") : L("Offline"),
                        valueTone: appState.network.isOnline ? .success : .warning)
            KeyValueRow(label: L("Notifications"), value: notificationStatus)
            KeyValueRow(label: L("Push registration"), value: pushStatus)
            KeyValueRow(label: L("Last synced"), value: appState.format(appState.lastSyncAt, storeId: appState.selectedStoreId, style: .timeWithSeconds))
            if let health {
                Divider().padding(.vertical, 4)
                Text(L("Service dependencies")).font(.subheadline.weight(.semibold))
                ForEach(health.dependencies.keys.sorted(), id: \.self) { key in
                    let state = health.dependencies[key] ?? .unrecognized
                    KeyValueRow(label: key.replacingOccurrences(of: "_", with: " "), value: dependencyText(state),
                                valueTone: state == .available ? .success : .warning)
                }
            }
        }
        .rgCard()
    }

    private func dependencyText(_ state: DependencyState) -> String {
        switch state {
        case .available: return L("Available")
        case .unavailable: return L("Unavailable")
        case .unconfigured: return L("Not configured")
        case .unrecognized: return L("Unknown status")
        }
    }

    private var notificationStatus: String {
        switch appState.push.authorization {
        case .authorized, .provisional, .ephemeral: return L("Allowed")
        case .denied: return L("Off")
        case .notDetermined: return L("Not asked yet")
        @unknown default: return L("Unknown status")
        }
    }

    private var pushStatus: String {
        switch appState.push.registration {
        case .registered: return L("Registered")
        case .registering: return L("Registering…")
        case .serverUnconfigured: return L("Not configured by organization")
        case .failed: return L("Failed")
        case .notRegistered: return L("Not registered")
        }
    }

    private func submit() async {
        var found: [String: String] = [:]
        if description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { found["description"] = L("Describe the issue.") }
        if !consent { found["consent"] = L("Consent is required to send diagnostics.") }
        errors = found
        guard found.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            result = try await appState.api.createSupportBundle(SupportBundleRequest(
                category: category, storeId: storeId, consent: true,
                description: description.trimmingCharacters(in: .whitespacesAndNewlines)))
            error = nil
            description = ""
            consent = false
        } catch {
            self.error = appState.present(error)
        }
    }
}
