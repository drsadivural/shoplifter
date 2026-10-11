import SwiftUI
import UIKit
import RetailGuardCore

/// ios-03 — Verify sign-in (TOTP or recovery code), and first-time MFA
/// enrollment when the role requires it.
struct MFAView: View {
    @Environment(AppState.self) private var appState
    let stage: MFAStage

    @State private var code = ""
    @State private var recoveryCode = ""
    @State private var useRecoveryCode = false
    @State private var trustDevice = false
    @State private var busy = false
    @State private var error: UserFacingError?
    @State private var setup: Loadable<MFASetup> = .idle
    @State private var copied = false

    var body: some View {
        AuthScaffold(title: stage == .verify ? L("Verify sign-in") : L("Set up two-step verification"),
                     subtitle: subtitle) {
            if !appState.recoveryCodes.isEmpty {
                recoveryCodesSection
            } else if stage == .enroll {
                enrollmentSection
            } else {
                verifySection
            }
            if let error { ErrorBanner(error: error) }
            Button(L("Cancel sign-in")) {
                Task { await appState.signOut(keepDrafts: true, remote: false) }
            }
            .buttonStyle(.rgSecondary)
        }
        .task {
            if stage == .enroll, case .idle = setup { await loadSetup() }
        }
    }

    private var subtitle: String {
        stage == .verify
            ? L("Enter the 6-digit code from your authenticator app.")
            : L("Your role requires two-step verification. Add RetailGuard to your authenticator app.")
    }

    // MARK: Verify

    @ViewBuilder private var verifySection: some View {
        if useRecoveryCode {
            LabeledInput(label: L("Recovery code"), hint: L("Each recovery code works once."), error: codeError) {
                TextField(L("Required"), text: $recoveryCode)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
            }
        } else {
            LabeledInput(label: L("Authentication code"), hint: nil, error: codeError) {
                TextField("123456", text: $code)
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .font(.title3.monospaced())
            }
        }
        Button(useRecoveryCode ? L("Use authentication code") : L("Use a recovery code")) {
            useRecoveryCode.toggle()
            error = nil
        }
        .font(.footnote)
        .rgTapTarget()
        Toggle(L("Trust this device"), isOn: $trustDevice)
            .tint(Color.rgPrimary)
        FieldHint(text: L("Trusted devices may skip this step until your organization's policy requires it again."))
        Button {
            Task { await verify() }
        } label: {
            HStack {
                if busy { ProgressView().tint(Color.rgOnPrimary) }
                Text(L("Verify"))
            }
        }
        .buttonStyle(.rgPrimary)
        .disabled(busy)
    }

    private var codeError: String? {
        if case .validation(let fields) = error?.kind, fields["code"] != nil { return error?.message }
        return nil
    }

    private func verify() async {
        if useRecoveryCode {
            guard !recoveryCode.trimmingCharacters(in: .whitespaces).isEmpty else {
                error = UserFacingError(kind: .validation(["code": "required"]), message: L("Enter a recovery code."), requestId: nil)
                return
            }
        } else {
            guard code.count == 6, code.allSatisfy(\.isNumber) else {
                error = UserFacingError(kind: .validation(["code": "format"]), message: L("Enter the 6-digit code."), requestId: nil)
                return
            }
        }
        busy = true
        defer { busy = false }
        error = await appState.verifyMFA(code: useRecoveryCode ? nil : code,
                                         recoveryCode: useRecoveryCode ? recoveryCode.trimmingCharacters(in: .whitespaces) : nil,
                                         trustDevice: trustDevice)
        if error != nil { code = "" }
    }

    // MARK: Enroll

    @ViewBuilder private var enrollmentSection: some View {
        switch setup {
        case .idle, .loading:
            ProgressView().frame(maxWidth: .infinity)
        case .failed(let failure):
            ErrorBanner(error: failure)
            Button(L("Retry")) { Task { await loadSetup() } }.buttonStyle(.rgSecondary)
        case .loaded(let value):
            VStack(alignment: .leading, spacing: 8) {
                Text(L("Setup key")).font(.subheadline.weight(.semibold))
                Text(value.secret)
                    .font(.body.monospaced())
                    .textSelection(.enabled)
                    .accessibilityLabel(L("Setup key"))
                HStack {
                    Button(copied ? L("Copied") : L("Copy key")) {
                        UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: value.secret]],
                                                      options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
                        copied = true
                    }
                    .buttonStyle(.rgSecondary)
                    if let url = URL(string: value.otpauthURI), UIApplication.shared.canOpenURL(url) {
                        Link(L("Open authenticator"), destination: url)
                            .buttonStyle(.rgSecondary)
                    }
                }
                FieldHint(text: L("The copied key is kept on this device only and cleared after 2 minutes."))
            }
            LabeledInput(label: L("Authentication code"), hint: nil, error: codeError) {
                TextField("123456", text: $code)
                    .textContentType(.oneTimeCode)
                    .keyboardType(.numberPad)
                    .font(.title3.monospaced())
            }
            Button {
                Task { await enable() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(Color.rgOnPrimary) }
                    Text(L("Turn on verification"))
                }
            }
            .buttonStyle(.rgPrimary)
            .disabled(busy)
        }
    }

    private func loadSetup() async {
        setup = .loading
        do {
            setup = .loaded(try await appState.mfaSetup())
        } catch {
            setup = .failed(appState.present(error, triggerSessionFlow: false))
        }
    }

    private func enable() async {
        guard code.count == 6, code.allSatisfy(\.isNumber) else {
            error = UserFacingError(kind: .validation(["code": "format"]), message: L("Enter the 6-digit code."), requestId: nil)
            return
        }
        busy = true
        defer { busy = false }
        error = await appState.enableMFA(code: code)
    }

    // MARK: Recovery codes (shown once)

    @ViewBuilder private var recoveryCodesSection: some View {
        InfoBanner(text: L("Save these recovery codes somewhere safe. They are shown only once and each works one time."),
                   tone: .warning, systemImage: "key")
        VStack(alignment: .leading, spacing: 4) {
            ForEach(appState.recoveryCodes, id: \.self) { code in
                Text(code).font(.body.monospaced()).textSelection(.enabled)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: 10))
        Button(L("Copy codes")) {
            UIPasteboard.general.setItems([[UIPasteboard.typeAutomatic: appState.recoveryCodes.joined(separator: "\n")]],
                                          options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(120)])
        }
        .buttonStyle(.rgSecondary)
        Button {
            Task {
                busy = true
                error = await appState.acknowledgeRecoveryCodes()
                busy = false
            }
        } label: {
            Text(L("I saved these codes"))
        }
        .buttonStyle(.rgPrimary)
        .disabled(busy)
    }
}
