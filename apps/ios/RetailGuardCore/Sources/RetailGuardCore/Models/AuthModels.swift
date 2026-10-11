import Foundation

// MARK: - Auth

public struct AuthConfig: Codable, Sendable, Equatable {
    public let oidcEnabled: Bool
    public let passwordLogin: Bool
    public let mfaRequiredRoles: [String]
    public let supportContact: String?

    enum CodingKeys: String, CodingKey {
        case oidcEnabled = "oidc_enabled"
        case passwordLogin = "password_login"
        case mfaRequiredRoles = "mfa_required_roles"
        case supportContact = "support_contact"
    }
}

public enum LoginState: String, LenientStringEnum {
    case authenticated
    case mfaRequired = "mfa_required"
    case mfaEnrollmentRequired = "mfa_enrollment_required"
    case unrecognized = "_unrecognized"
}

public struct LoginRequest: Encodable, Sendable {
    public let email: String
    public let password: String
    public let client: String

    public init(email: String, password: String) {
        self.email = email
        self.password = password
        self.client = "ios"
    }
}

public struct LoginResponse: Codable, Sendable, Equatable {
    public let state: LoginState
    /// Returned for `client: "ios"`. While `state` is an MFA state this token is
    /// only valid for the MFA endpoints (session `mfa_verified == false`).
    public let token: String?
    public let expiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case state, token
        case expiresAt = "expires_at"
    }
}

public struct MFAVerifyRequest: Encodable, Sendable {
    public let code: String?
    public let recoveryCode: String?
    public let trustDevice: Bool?

    public init(code: String? = nil, recoveryCode: String? = nil, trustDevice: Bool? = nil) {
        self.code = code
        self.recoveryCode = recoveryCode
        self.trustDevice = trustDevice
    }

    enum CodingKeys: String, CodingKey {
        case code
        case recoveryCode = "recovery_code"
        case trustDevice = "trust_device"
    }
}

public struct AuthStateResponse: Codable, Sendable, Equatable {
    public let state: LoginState
    public let recoveryCodes: [String]?

    enum CodingKeys: String, CodingKey {
        case state
        case recoveryCodes = "recovery_codes"
    }
}

public struct MFASetup: Codable, Sendable, Equatable {
    public let secret: String
    public let otpauthURI: String

    enum CodingKeys: String, CodingKey {
        case secret
        case otpauthURI = "otpauth_uri"
    }
}

// MARK: - Me

public enum Role: String, LenientStringEnum {
    case viewer, responder, investigator
    case storeAdmin = "store_admin"
    case orgAdmin = "org_admin"
    case unrecognized = "_unrecognized"
}

public enum ThemePreference: String, LenientStringEnum {
    case light, dark, system
    case unrecognized = "_unrecognized"
}

public struct QuietHours: Codable, Sendable, Equatable {
    /// `HH:mm`, store-local.
    public var start: String
    public var end: String

    public init(start: String, end: String) {
        self.start = start
        self.end = end
    }
}

public struct NotificationPrefs: Codable, Sendable, Equatable {
    public var behavior: Bool
    public var watchlist: Bool
    public var checkout: Bool
    public var rfid: Bool
    public var sound: Bool
    /// Always `true` in the contract: lock-screen text never carries details.
    public var privatePreview: Bool
    public var quietHours: QuietHours?
    public var storeIds: [String]

    public init(behavior: Bool, watchlist: Bool, checkout: Bool, rfid: Bool, sound: Bool,
                privatePreview: Bool = true, quietHours: QuietHours?, storeIds: [String]) {
        self.behavior = behavior
        self.watchlist = watchlist
        self.checkout = checkout
        self.rfid = rfid
        self.sound = sound
        self.privatePreview = privatePreview
        self.quietHours = quietHours
        self.storeIds = storeIds
    }

    enum CodingKeys: String, CodingKey {
        case behavior, watchlist, checkout, rfid, sound
        case privatePreview = "private_preview"
        case quietHours = "quiet_hours"
        case storeIds = "store_ids"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        behavior = try c.decodeIfPresent(Bool.self, forKey: .behavior) ?? true
        watchlist = try c.decodeIfPresent(Bool.self, forKey: .watchlist) ?? true
        checkout = try c.decodeIfPresent(Bool.self, forKey: .checkout) ?? true
        rfid = try c.decodeIfPresent(Bool.self, forKey: .rfid) ?? true
        sound = try c.decodeIfPresent(Bool.self, forKey: .sound) ?? true
        privatePreview = try c.decodeIfPresent(Bool.self, forKey: .privatePreview) ?? true
        quietHours = try c.decodeIfPresent(QuietHours.self, forKey: .quietHours)
        storeIds = try c.decodeIfPresent([String].self, forKey: .storeIds) ?? []
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(behavior, forKey: .behavior)
        try c.encode(watchlist, forKey: .watchlist)
        try c.encode(checkout, forKey: .checkout)
        try c.encode(rfid, forKey: .rfid)
        try c.encode(sound, forKey: .sound)
        try c.encode(true, forKey: .privatePreview) // contract: always true
        if let quietHours {
            try c.encode(quietHours, forKey: .quietHours)
        } else {
            try c.encodeNil(forKey: .quietHours)
        }
        try c.encode(storeIds, forKey: .storeIds)
    }
}

public struct MeUser: Codable, Sendable, Equatable {
    public let id: String
    public let email: String
    public let displayName: String
    public let role: Role
    public let locale: String?
    public let theme: ThemePreference?
    public let mfaEnabled: Bool
    public let notificationPrefs: NotificationPrefs?

    enum CodingKeys: String, CodingKey {
        case id, email, role, locale, theme
        case displayName = "display_name"
        case mfaEnabled = "mfa_enabled"
        case notificationPrefs = "notification_prefs"
    }
}

public struct OrgRef: Codable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let timezone: String
    public let region: String?
}

public struct StoreRef: Codable, Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let name: String
    public let timezone: String
    public let region: String?

    public init(id: String, name: String, timezone: String, region: String?) {
        self.id = id
        self.name = name
        self.timezone = timezone
        self.region = region
    }
}

public struct SessionState: Codable, Sendable, Equatable {
    public let id: String
    public let expiresAt: Date
    public let mfaVerified: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case expiresAt = "expires_at"
        case mfaVerified = "mfa_verified"
    }
}

public struct Me: Codable, Sendable, Equatable {
    public let user: MeUser
    public let org: OrgRef
    public let stores: [StoreRef]
    public let permissions: [String]
    public let session: SessionState
    public let unreadNotifications: Int

    enum CodingKeys: String, CodingKey {
        case user, org, stores, permissions, session
        case unreadNotifications = "unread_notifications"
    }

    public var permissionSet: Set<String> { Set(permissions) }

    public func can(_ permission: Permission) -> Bool {
        permissions.contains(permission.rawValue)
    }

    public func store(id: String?) -> StoreRef? {
        guard let id else { return nil }
        return stores.first { $0.id == id }
    }

    public func storeTime(for storeId: String?) -> StoreTime {
        StoreTime(timeZoneIdentifier: store(id: storeId)?.timezone, fallbackIdentifier: org.timezone)
    }
}

/// Permission action strings from `GET /v1/roles`.
public enum Permission: String, CaseIterable, Sendable {
    case dashboardRead = "dashboard.read"
    case incidentRead = "incident.read"
    case incidentCreate = "incident.create"
    case incidentRespond = "incident.respond"
    case incidentReopen = "incident.reopen"
    case caseRead = "case.read"
    case caseManage = "case.manage"
    case exportCreate = "export.create"
    case searchMetadata = "search.metadata"
    case searchPhoto = "search.photo"
    case profileRead = "profile.read"
    case staffManage = "staff.manage"
    case watchlistManage = "watchlist.manage"
    case watchlistApprove = "watchlist.approve"
    case photoRead = "photo.read"
    case cameraRead = "camera.read"
    case cameraManage = "camera.manage"
    case edgeManage = "edge.manage"
    case storeRead = "store.read"
    case storeManage = "store.manage"
    case policyManage = "policy.manage"
    case integrationManage = "integration.manage"
    case reportRead = "report.read"
    case auditRead = "audit.read"
    case userManage = "user.manage"
    case orgManage = "org.manage"
    case modelManage = "model.manage"
    case privacyManage = "privacy.manage"
    case healthRead = "health.read"
    case supportCreate = "support.create"
}

public struct PreferencesUpdate: Encodable, Sendable {
    public var locale: String?
    public var theme: ThemePreference?
    public var notificationPrefs: NotificationPrefs?

    public init(locale: String? = nil, theme: ThemePreference? = nil, notificationPrefs: NotificationPrefs? = nil) {
        self.locale = locale
        self.theme = theme
        self.notificationPrefs = notificationPrefs
    }

    enum CodingKeys: String, CodingKey {
        case locale, theme
        case notificationPrefs = "notification_prefs"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(locale, forKey: .locale)
        try c.encodeIfPresent(theme?.rawValue, forKey: .theme)
        try c.encodeIfPresent(notificationPrefs, forKey: .notificationPrefs)
    }
}

public struct UserSession: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let client: String?
    public let createdAt: Date?
    public let lastSeenAt: Date?
    public let expiresAt: Date?
    public let current: Bool
    public let userAgent: String?

    enum CodingKeys: String, CodingKey {
        case id, client, current
        case createdAt = "created_at"
        case lastSeenAt = "last_seen_at"
        case expiresAt = "expires_at"
        case userAgent = "user_agent"
    }
}
