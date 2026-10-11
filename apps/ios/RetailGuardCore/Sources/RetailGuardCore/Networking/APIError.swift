import Foundation

/// Error body: `{code, message, request_id, retriable, field_errors?, current_version?}`.
public struct APIErrorBody: Codable, Sendable, Equatable {
    public let code: String
    public let message: String
    public let requestId: String?
    public let retriable: Bool
    public let fieldErrors: [String: String]?
    public let currentVersion: Int?

    public init(code: String, message: String, requestId: String? = nil, retriable: Bool = false,
                fieldErrors: [String: String]? = nil, currentVersion: Int? = nil) {
        self.code = code
        self.message = message
        self.requestId = requestId
        self.retriable = retriable
        self.fieldErrors = fieldErrors
        self.currentVersion = currentVersion
    }

    enum CodingKeys: String, CodingKey {
        case code, message, retriable
        case requestId = "request_id"
        case fieldErrors = "field_errors"
        case currentVersion = "current_version"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try c.decode(String.self, forKey: .code)
        message = try c.decodeIfPresent(String.self, forKey: .message) ?? ""
        requestId = try c.decodeIfPresent(String.self, forKey: .requestId)
        retriable = try c.decodeIfPresent(Bool.self, forKey: .retriable) ?? false
        fieldErrors = try? c.decodeIfPresent([String: String].self, forKey: .fieldErrors)
        currentVersion = try c.decodeIfPresent(Int.self, forKey: .currentVersion)
    }
}

/// Well-known error codes from docs/API_V1.md.
public enum APIErrorCode {
    public static let authenticationRequired = "authentication_required"
    public static let sessionExpired = "session_expired"
    public static let mfaRequired = "mfa_required"
    public static let mfaEnrollmentRequired = "mfa_enrollment_required"
    public static let invalidCredentials = "invalid_credentials"
    public static let invalidCode = "invalid_code"
    public static let rateLimited = "rate_limited"
    public static let forbidden = "forbidden"
    public static let ownedByAnotherResponder = "owned_by_another_responder"
    public static let evidencePending = "evidence_pending"
    public static let faceSDKUnavailable = "face_sdk_unavailable"
    public static let modelUnavailable = "model_unavailable"
    public static let edgeUnavailable = "edge_unavailable"
    public static let pushUnconfigured = "push_unconfigured"
    public static let oidcUnconfigured = "oidc_unconfigured"
    public static let reidUnavailable = "reid_unavailable"
}

/// Typed failure for every API call.
public enum APIError: Error, Sendable, Equatable {
    /// 400
    case badRequest(APIErrorBody)
    /// 401: no/expired session or an MFA step is required.
    case unauthenticated(APIErrorBody)
    /// 403
    case forbidden(APIErrorBody)
    /// 404: not found or not in the caller's scope.
    case notFound(APIErrorBody)
    /// 409: version/idempotency/ownership conflict; `current_version` when known.
    case conflict(APIErrorBody)
    /// 413
    case payloadTooLarge(APIErrorBody)
    /// 415
    case unsupportedMedia(APIErrorBody)
    /// 422 with `field_errors`.
    case validation(APIErrorBody)
    /// 429
    case rateLimited(APIErrorBody)
    /// 503: a dependency (face SDK, model, edge, push) is unavailable.
    case dependencyUnavailable(APIErrorBody)
    /// Other non-2xx statuses.
    case server(status: Int, body: APIErrorBody?)
    /// The device has no connectivity / the host could not be reached.
    case offline
    /// Other transport-level failure (TLS, cancelled, …).
    case transport(String)
    /// Response could not be decoded into the expected contract type.
    case decoding(String)
    /// No local session token is available for an authenticated request.
    case notSignedIn
    /// The configured base URL is not acceptable (non-HTTPS, credentials, …).
    case invalidBaseURL

    public var body: APIErrorBody? {
        switch self {
        case .badRequest(let b), .unauthenticated(let b), .forbidden(let b), .notFound(let b),
             .conflict(let b), .payloadTooLarge(let b), .unsupportedMedia(let b), .validation(let b),
             .rateLimited(let b), .dependencyUnavailable(let b):
            return b
        case .server(_, let b):
            return b
        default:
            return nil
        }
    }

    public var code: String? { body?.code }
    public var requestId: String? { body?.requestId }
    public var currentVersion: Int? { body?.currentVersion }
    public var fieldErrors: [String: String] { body?.fieldErrors ?? [:] }

    public var isConflict: Bool {
        if case .conflict = self { return true }
        return false
    }

    /// 401 meaning the retained session is gone; the app must show the
    /// session-expired screen and keep local drafts.
    public var isSessionExpired: Bool {
        guard case .unauthenticated(let b) = self else {
            if case .notSignedIn = self { return true }
            return false
        }
        return b.code == APIErrorCode.sessionExpired || b.code == APIErrorCode.authenticationRequired
    }

    public var requiresMFA: Bool {
        guard case .unauthenticated(let b) = self else { return false }
        return b.code == APIErrorCode.mfaRequired || b.code == APIErrorCode.mfaEnrollmentRequired
    }

    public var isDependencyUnavailable: Bool {
        if case .dependencyUnavailable = self { return true }
        return false
    }

    public var isOffline: Bool { self == .offline }

    static func from(status: Int, body: APIErrorBody?) -> APIError {
        let fallback = body ?? APIErrorBody(code: "http_\(status)", message: "")
        switch status {
        case 400: return .badRequest(fallback)
        case 401: return .unauthenticated(fallback)
        case 403: return .forbidden(fallback)
        case 404: return .notFound(fallback)
        case 409: return .conflict(fallback)
        case 413: return .payloadTooLarge(fallback)
        case 415: return .unsupportedMedia(fallback)
        case 422: return .validation(fallback)
        case 429: return .rateLimited(fallback)
        case 503: return .dependencyUnavailable(fallback)
        default: return .server(status: status, body: body)
        }
    }
}
