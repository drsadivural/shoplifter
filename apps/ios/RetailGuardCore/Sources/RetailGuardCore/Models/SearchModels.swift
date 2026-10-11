import Foundation

public struct TimeSpan: Codable, Sendable, Equatable, Hashable {
    public let from: Date
    public let to: Date
}

public struct CoverageCamera: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let storeId: String?
    public let activatedAt: Date?
    public let outages: [TimeSpan]

    enum CodingKeys: String, CodingKey {
        case id, name, outages
        case storeId = "store_id"
        case activatedAt = "activated_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        storeId = try c.decodeIfPresent(String.self, forKey: .storeId)
        activatedAt = try c.decodeIfPresent(Date.self, forKey: .activatedAt)
        outages = try c.decodeIfPresent([TimeSpan].self, forKey: .outages) ?? []
    }
}

public enum CoverageGapReason: String, LenientStringEnum {
    case beforeActivation = "before_activation"
    case outage
    case beyondRetention = "beyond_retention"
    case noCameras = "no_cameras"
    case unrecognized = "_unrecognized"
}

public struct CoverageGap: Codable, Sendable, Equatable, Hashable {
    public let cameraId: String?
    public let from: Date
    public let to: Date
    public let reason: CoverageGapReason

    enum CodingKeys: String, CodingKey {
        case from, to, reason
        case cameraId = "camera_id"
    }
}

public struct SearchCoverage: Codable, Sendable, Equatable {
    public let from: Date?
    public let to: Date?
    public let retentionCutoff: Date?
    public let cameras: [CoverageCamera]
    public let gaps: [CoverageGap]

    enum CodingKeys: String, CodingKey {
        case from, to, cameras, gaps
        case retentionCutoff = "retention_cutoff"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        from = try c.decodeIfPresent(Date.self, forKey: .from)
        to = try c.decodeIfPresent(Date.self, forKey: .to)
        retentionCutoff = try c.decodeIfPresent(Date.self, forKey: .retentionCutoff)
        cameras = try c.decodeIfPresent([CoverageCamera].self, forKey: .cameras) ?? []
        gaps = try c.decodeIfPresent([CoverageGap].self, forKey: .gaps) ?? []
    }
}

public struct SearchResponse: Decodable, Sendable, Equatable {
    public let items: [IncidentSummary]
    public let nextCursor: String?
    public let coverage: SearchCoverage?

    enum CodingKeys: String, CodingKey {
        case items, coverage
        case nextCursor = "next_cursor"
    }
}

/// Filters for `GET /v1/incidents` and `GET /v1/search`.
public struct IncidentQuery: Sendable, Equatable, Hashable {
    public var storeId: String?
    public var cameraId: String?
    public var channel: IncidentChannel?
    public var status: IncidentStatus?
    public var outcome: Outcome?
    /// `"me"` or a user id.
    public var assignee: String?
    public var text: String?
    public var from: Date?
    public var to: Date?
    public var evidenceState: EvidenceState?
    public var profileId: String?
    public var limit: Int?

    public init(storeId: String? = nil, cameraId: String? = nil, channel: IncidentChannel? = nil,
                status: IncidentStatus? = nil, outcome: Outcome? = nil, assignee: String? = nil,
                text: String? = nil, from: Date? = nil, to: Date? = nil, evidenceState: EvidenceState? = nil,
                profileId: String? = nil, limit: Int? = nil) {
        self.storeId = storeId
        self.cameraId = cameraId
        self.channel = channel
        self.status = status
        self.outcome = outcome
        self.assignee = assignee
        self.text = text
        self.from = from
        self.to = to
        self.evidenceState = evidenceState
        self.profileId = profileId
        self.limit = limit
    }

    func queryItems(forSearch: Bool, cursor: String?) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        func add(_ name: String, _ value: String?) {
            if let value, !value.isEmpty { items.append(URLQueryItem(name: name, value: value)) }
        }
        add("store_id", storeId)
        add("camera_id", cameraId)
        add("channel", channel?.rawValue)
        if !forSearch { add("status", status?.rawValue) }
        add("outcome", outcome?.rawValue)
        add("assignee", assignee)
        if !forSearch { add("q", text?.trimmingCharacters(in: .whitespacesAndNewlines)) }
        add("from", from.map(RFC3339.format))
        add("to", to.map(RFC3339.format))
        add("evidence_state", evidenceState?.rawValue)
        if forSearch { add("profile_id", profileId) }
        if let limit { add("limit", String(max(1, min(100, limit)))) }
        add("cursor", cursor)
        return items
    }
}

// MARK: - Support / health / push

public struct PushDeviceRequest: Encodable, Sendable, Equatable {
    public let token: String
    public let environment: APNsEnvironment
    public let bundleId: String

    public init(token: String, environment: APNsEnvironment, bundleId: String) {
        self.token = token
        self.environment = environment
        self.bundleId = bundleId
    }

    enum CodingKeys: String, CodingKey {
        case token, environment
        case bundleId = "bundle_id"
    }
}

public enum APNsEnvironment: String, Codable, Sendable {
    case sandbox, production
}

public struct IdResponse: Codable, Sendable, Equatable {
    public let id: String
}

public enum SupportCategory: String, CaseIterable, Sendable {
    case camera
    case notification
    case access
    case other
}

public struct SupportBundleRequest: Encodable, Sendable {
    public let category: String
    public let storeId: String?
    public let consent: Bool
    public let description: String

    public init(category: SupportCategory, storeId: String?, consent: Bool, description: String) {
        self.category = category.rawValue
        self.storeId = storeId
        self.consent = consent
        self.description = description
    }

    enum CodingKeys: String, CodingKey {
        case category, consent, description
        case storeId = "store_id"
    }
}

public struct SupportBundle: Codable, Sendable, Equatable {
    public let id: String
    public let downloadUrl: String?
    public let expiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case downloadUrl = "download_url"
        case expiresAt = "expires_at"
    }
}

public enum DependencyState: String, LenientStringEnum {
    case available, unavailable, unconfigured
    case unrecognized = "_unrecognized"
}

public struct SystemHealth: Decodable, Sendable, Equatable {
    public let dependencies: [String: DependencyState]

    enum CodingKeys: String, CodingKey { case dependencies }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        dependencies = try c.decodeIfPresent([String: DependencyState].self, forKey: .dependencies) ?? [:]
    }
}
