import SwiftUI
import RetailGuardCore

/// ios-01 — Welcome: choose the company workspace (API origin), validated by
/// `GET /v1/auth/config` before continuing.
struct WelcomeView: View {
    @Environment(AppState.self) private var appState
    @State private var workspace = ""
    @State private var busy = false
    @State private var error: UserFacingError?

    var body: some View {
        AuthScaffold(title: L("Welcome to RetailGuard"), subtitle: L("Secure access to your assigned stores")) {
            LabeledInput(label: L("Company workspace"),
                         hint: L("The address your organization gave you, for example shoplifter.ayonix.com."),
                         error: workspaceError) {
                TextField(L("Required"), text: $workspace)
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.continue)
                    .onSubmit { Task { await submit() } }
                    .disabled(!appState.config.allowsWorkspaceOverride && appState.config.defaultBaseURL != nil)
            }
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "lock.shield").foregroundStyle(Color.rgPrimary).accessibilityHidden(true)
                Text(L("Secure store response: alerts, evidence and outcomes stay inside your organization's workspace."))
                    .font(.caption)
                    .foregroundStyle(Color.rgSecondaryText)
            }
            if let error, workspaceError == nil {
                ErrorBanner(error: error)
            }
            Button {
                Task { await submit() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(Color.rgOnPrimary) }
                    Text(L("Continue"))
                }
            }
            .buttonStyle(.rgPrimary)
            .disabled(busy)
        }
        .onAppear {
            if workspace.isEmpty {
                workspace = appState.preferences.workspaceOrigin.flatMap { URL(string: $0)?.host }
                    ?? appState.config.defaultBaseURL?.host ?? ""
            }
        }
    }

    private var workspaceError: String? {
        if case .validation(let fields) = error?.kind, fields["workspace"] != nil { return error?.message }
        return nil
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        error = await appState.setWorkspace(workspace)
    }
}

/// ios-02 — Sign in with work email and password (`client: "ios"`).
struct LoginView: View {
    @Environment(AppState.self) private var appState
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: UserFacingError?
    @State private var resetSent = false
    @State private var fieldErrors: [String: String] = [:]
    @FocusState private var focus: Field?

    enum Field { case email, password }

    var body: some View {
        AuthScaffold(title: L("Sign in"), subtitle: L("Secure access to your assigned stores")) {
            LabeledInput(label: L("Work email"), hint: nil, error: fieldErrors["email"]) {
                TextField(L("name@company.com"), text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
            }
            LabeledInput(label: L("Password"), hint: nil, error: fieldErrors["password"]) {
                SecureField(L("Required"), text: $password)
                    .textContentType(.password)
                    .focused($focus, equals: .password)
                    .submitLabel(.go)
                    .onSubmit { Task { await signIn() } }
            }
            if let error { ErrorBanner(error: error) }
            if resetSent {
                InfoBanner(text: L("If an account exists for this email, a reset link has been sent."), tone: .info,
                           systemImage: "envelope")
            }
            Button {
                Task { await signIn() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(Color.rgOnPrimary) }
                    Text(L("Sign in"))
                }
            }
            .buttonStyle(.rgPrimary)
            .disabled(busy)

            CompanySSONotice()

            HStack {
                Button(L("Forgot password?")) { Task { await requestReset() } }
                    .font(.footnote)
                    .rgTapTarget()
                Spacer()
                Button(L("Change workspace")) { appState.changeWorkspace() }
                    .font(.footnote)
                    .rgTapTarget()
            }
            Text(LF("Workspace: %@", appState.workspaceDisplay))
                .font(.caption)
                .foregroundStyle(Color.rgSecondaryText)
        }
        .task {
            if email.isEmpty { email = appState.preferences.lastEmail ?? "" }
            if appState.authConfig == nil { await appState.loadAuthConfig() }
        }
    }

    private func validate() -> Bool {
        var errors: [String: String] = [:]
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty || !trimmed.contains("@") { errors["email"] = L("Enter your work email address.") }
        if password.isEmpty { errors["password"] = L("Enter your password.") }
        fieldErrors = errors
        return errors.isEmpty
    }

    private func signIn() async {
        error = nil
        resetSent = false
        guard validate() else { return }
        busy = true
        defer { busy = false }
        error = await appState.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        if error == nil { password = "" }
    }

    /// Always reports the same message whether or not the account exists.
    private func requestReset() async {
        error = nil
        let trimmed = email.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.contains("@") else {
            fieldErrors = ["email": L("Enter your work email address.")]
            return
        }
        fieldErrors = [:]
        do {
            try await appState.api.requestPasswordReset(email: trimmed)
            resetSent = true
        } catch {
            self.error = appState.present(error, triggerSessionFlow: false)
        }
    }
}
