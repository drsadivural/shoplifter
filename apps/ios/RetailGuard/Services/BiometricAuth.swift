import Foundation
import LocalAuthentication

/// Face ID / Touch ID app unlock. Biometrics are evaluated by iOS on the
/// device and only gate access to the session already retained in the
/// Keychain. This is unrelated to — and never enrolls the user into — the
/// retail watchlist or any face recognition gallery.
enum BiometricAuth {
    enum Kind: Equatable {
        case none, faceID, touchID, opticID

        var displayName: String {
            switch self {
            case .faceID: return "Face ID"
            case .touchID: return "Touch ID"
            case .opticID: return "Optic ID"
            case .none: return L("Biometrics")
            }
        }

        var systemImage: String {
            switch self {
            case .touchID: return "touchid"
            case .opticID: return "opticid"
            default: return "faceid"
            }
        }
    }

    enum Availability: Equatable {
        case available(Kind)
        /// Hardware present but not enrolled in Settings.
        case notEnrolled(Kind)
        /// The user denied biometric use for this app.
        case denied(Kind)
        /// Locked out after failed attempts; passcode required in Settings.
        case lockedOut(Kind)
        case unavailable
    }

    enum Failure: Error, Equatable {
        case cancelled
        case fallbackToPassword
        case failed
        case unavailable
    }

    static func availability() -> Availability {
        let context = LAContext()
        var error: NSError?
        let ok = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        let kind = Self.biometryKind(of: context)
        if ok { return .available(kind) }
        guard let error else { return .unavailable }
        let code = LAError.Code(rawValue: error.code) ?? .biometryNotAvailable
        switch code {
        case .biometryNotEnrolled: return .notEnrolled(kind)
        case .biometryLockout: return .lockedOut(kind)
        case .biometryNotAvailable:
            // When the user declined the Face ID permission prompt the type
            // is still reported, but evaluation is not available.
            return kind == .none ? .unavailable : .denied(kind)
        default: return .unavailable
        }
    }

    static func authenticate(reason: String) async -> Result<Void, Failure> {
        let context = LAContext()
        context.localizedFallbackTitle = L("Use password")
        context.localizedCancelTitle = L("Cancel")
        do {
            let ok = try await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)
            return ok ? .success(()) : .failure(.failed)
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .systemCancel, .appCancel: return .failure(.cancelled)
            case .userFallback: return .failure(.fallbackToPassword)
            case .biometryNotAvailable, .biometryNotEnrolled, .biometryLockout: return .failure(.unavailable)
            default: return .failure(.failed)
            }
        } catch {
            return .failure(.failed)
        }
    }

    static func biometryKind(of context: LAContext) -> Kind {
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return .none
        }
    }
}
