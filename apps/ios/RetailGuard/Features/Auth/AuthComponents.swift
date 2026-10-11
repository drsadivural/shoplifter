import SwiftUI
import RetailGuardCore

/// Centered brand + card layout used by the sign-in flow (mockups ios-01…05, 33).
struct AuthScaffold<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                BrandMark()
                    .padding(.top, 48)
                VStack(alignment: .leading, spacing: 16) {
                    Text(title)
                        .font(.largeTitle.bold())
                        .foregroundStyle(Color.rgInk)
                        .accessibilityAddTraits(.isHeader)
                    if let subtitle {
                        Text(subtitle)
                            .font(.body)
                            .foregroundStyle(Color.rgSecondaryText)
                    }
                    content()
                    AuthFooter()
                }
                .padding(20)
                .background(Color.rgSurface, in: RoundedRectangle(cornerRadius: RGMetrics.cardRadius, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: RGMetrics.cardRadius, style: .continuous)
                    .strokeBorder(Color.rgBorder, lineWidth: 1))
            }
            .padding(.horizontal, RGMetrics.gutter)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color.rgBackground.ignoresSafeArea())
    }
}

/// "Need assistance?" + language switch (English / 日本語).
struct AuthFooter: View {
    @State private var showingHelp = false

    var body: some View {
        HStack {
            Button(L("Need assistance?")) { showingHelp = true }
                .font(.footnote)
                .rgTapTarget()
            Spacer()
            LanguageMenu()
        }
        .sheet(isPresented: $showingHelp) { AuthHelpSheet() }
    }
}

struct LanguageMenu: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Menu {
            ForEach(AppLanguage.allCases) { language in
                Button {
                    appState.preferences.language = language
                    appState.api.setAcceptLanguage(Localizer.effectiveLanguageCode)
                } label: {
                    if appState.preferences.language == language {
                        Label(language.nativeName, systemImage: "checkmark")
                    } else {
                        Text(language.nativeName)
                    }
                }
            }
        } label: {
            Text(verbatim: "English / 日本語")
                .font(.footnote)
                .rgTapTarget()
        }
        .accessibilityLabel(L("Language"))
        .accessibilityValue(appState.preferences.language.nativeName)
    }
}

/// Pre-authentication help: shows the organization's support contact from
/// `GET /v1/auth/config`. Diagnostics bundles require sign-in (ios-34).
struct AuthHelpSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(L("For access problems, contact your organization's RetailGuard administrator. Support never asks for your password."))
                        .font(.subheadline)
                }
                Section(L("Contact support")) {
                    if let contact = appState.authConfig?.supportContact, !contact.isEmpty {
                        if let url = SupportContact.url(for: contact) {
                            Link(destination: url) {
                                Label(contact, systemImage: contact.contains("@") ? "envelope" : "link")
                            }
                        } else {
                            Text(contact).textSelection(.enabled)
                        }
                    } else {
                        Text(L("Your organization has not published a support contact. Ask your store manager."))
                            .foregroundStyle(Color.rgSecondaryText)
                    }
                }
                Section(L("Workspace")) {
                    Text(appState.workspaceDisplay).font(.body.monospaced())
                }
            }
            .navigationTitle(L("Need assistance?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } }
            }
            .task { if appState.authConfig == nil { await appState.loadAuthConfig() } }
        }
    }
}

enum SupportContact {
    static func url(for contact: String) -> URL? {
        let trimmed = contact.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.contains("@"), !trimmed.contains("://") {
            return URL(string: "mailto:\(trimmed)")
        }
        if let url = URL(string: trimmed), url.scheme == "https" || url.scheme == "mailto" || url.scheme == "tel" {
            return url
        }
        return nil
    }
}

/// Explains Company SSO availability on iOS. The API's OIDC flow
/// (`/v1/auth/oidc/start`) establishes a browser cookie session and redirects
/// to the web console; it does not issue the bearer token the app needs.
struct CompanySSONotice: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        if appState.authConfig?.oidcEnabled == true {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "building.2").foregroundStyle(Color.rgPrimary).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Company SSO")).font(.subheadline.weight(.semibold))
                    Text(L("Your organization uses company SSO in the web console. Mobile SSO is not yet available; sign in with your work email and password, or ask your administrator."))
                        .font(.caption)
                        .foregroundStyle(Color.rgSecondaryText)
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}
