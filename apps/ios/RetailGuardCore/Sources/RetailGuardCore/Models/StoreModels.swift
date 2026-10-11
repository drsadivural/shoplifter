import Foundation

public enum EdgeState: String, LenientStringEnum {
    case unpaired, online, offline, revoked
    case unrecognized = "_unrecognized"
}

public struct StoreCoverage: Codable, Sendable, Equatable {
    public let camerasTotal: Int
    public let camerasReady: Int
    public let camerasAnalyzing: Int

    enum CodingKeys: String, CodingKey {
        case camerasTotal = "cameras_total"
        case camerasReady = "cameras_ready"
        case camerasAnalyzing = "cameras_analyzing"
    }
}

public struct StoreSummary: Codable, Sendable, Equatable {
    public let coverage: StoreCoverage?
    public let openIncidents: Int?
    public let reviewQueue: Int?
    public let lastRefresh: Date?

    enum CodingKeys: String, CodingKey {
        case coverage
        case openIncidents = "open_incidents"
        case reviewQueue = "review_queue"
        case lastRefresh = "last_refresh"
    }
}

public struct Store: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let region: String?
    public let address: String?
    public let timezone: String
    public let managerName: String?
    /// Shape not fixed by the contract (string or structured hours).
    public let openingHours: JSONValue?
    public let version: Int
    public let cameraCount: Int
    public let camerasReady: Int
    public let openAlerts: Int
    public let edgeState: EdgeState
    public let summary: StoreSummary?

    enum CodingKeys: String, CodingKey {
        case id, name, region, address, timezone, version, summary
        case managerName = "manager_name"
        case openingHours = "opening_hours"
        case cameraCount = "camera_count"
        case camerasReady = "cameras_ready"
        case openAlerts = "open_alerts"
        case edgeState = "edge_state"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        region = try c.decodeIfPresent(String.self, forKey: .region)
        address = try c.decodeIfPresent(String.self, forKey: .address)
        timezone = try c.decode(String.self, forKey: .timezone)
        managerName = try c.decodeIfPresent(String.self, forKey: .managerName)
        openingHours = try c.decodeIfPresent(JSONValue.self, forKey: .openingHours)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 0
        cameraCount = try c.decodeIfPresent(Int.self, forKey: .cameraCount) ?? 0
        camerasReady = try c.decodeIfPresent(Int.self, forKey: .camerasReady) ?? 0
        openAlerts = try c.decodeIfPresent(Int.self, forKey: .openAlerts) ?? 0
        edgeState = try c.decodeIfPresent(EdgeState.self, forKey: .edgeState) ?? .unrecognized
        summary = try c.decodeIfPresent(StoreSummary.self, forKey: .summary)
    }
}

// MARK: - Cameras

public enum CameraReadiness: String, LenientStringEnum {
    case pending, ready, degraded, offline, disabled
    case unrecognized = "_unrecognized"
}

public enum AnalysisState: String, LenientStringEnum {
    case unavailable
    case activationRequested = "activation_requested"
    case analyzing, paused, degraded
    case unrecognized = "_unrecognized"
}

public enum ChannelRunState: String, LenientStringEnum {
    case notRequested = "not_requested"
    case unavailable, starting, running, degraded
    case unrecognized = "_unrecognized"
}

/// Camera channel status. The contract describes `channels: {behavior: state}`
/// "with optional reason", so both `"running"` and `{"state": "unavailable",
/// "reason": "face_sdk_unavailable"}` are accepted.
public struct ChannelStatus: Codable, Sendable, Equatable {
    public let state: ChannelRunState
    public let reason: String?

    public init(state: ChannelRunState, reason: String?) {
        self.state = state
        self.reason = reason
    }

    enum CodingKeys: String, CodingKey { case state, reason }

    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let raw = try? single.decode(String.self) {
            state = ChannelRunState(rawValue: raw) ?? .unrecognized
            reason = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        state = try c.decode(ChannelRunState.self, forKey: .state)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(state, forKey: .state)
        try c.encodeIfPresent(reason, forKey: .reason)
    }
}

public struct ReadinessReport: Codable, Sendable, Equatable {
    public let checkedAt: Date?
    public let codec: String?
    public let width: Int?
    public let height: Int?
    public let fps: Double?
    public let decodedSeconds: Double?
    public let monotonicTime: Bool?
    public let errors: [String]

    enum CodingKeys: String, CodingKey {
        case codec, width, height, fps, errors
        case checkedAt = "checked_at"
        case decodedSeconds = "decoded_seconds"
        case monotonicTime = "monotonic_time"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        checkedAt = try c.decodeIfPresent(Date.self, forKey: .checkedAt)
        codec = try c.decodeIfPresent(String.self, forKey: .codec)
        width = try c.decodeIfPresent(Int.self, forKey: .width)
        height = try c.decodeIfPresent(Int.self, forKey: .height)
        fps = try c.decodeIfPresent(Double.self, forKey: .fps)
        decodedSeconds = try c.decodeIfPresent(Double.self, forKey: .decodedSeconds)
        monotonicTime = try c.decodeIfPresent(Bool.self, forKey: .monotonicTime)
        errors = (try? c.decodeIfPresent([String].self, forKey: .errors)) ?? []
    }
}

public struct CameraSnapshot: Codable, Sendable, Equatable {
    public let mediaId: String
    public let capturedAt: Date

    enum CodingKeys: String, CodingKey {
        case mediaId = "media_id"
        case capturedAt = "captured_at"
    }
}

public struct Camera: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let storeId: String
    public let edgeId: String?
    public let name: String
    public let location: String?
    public let vendor: String?
    public let model: String?
    public let streamProfile: String?
    public let readiness: CameraReadiness
    public let analysisState: AnalysisState
    public let channels: [String: ChannelStatus]
    public let readinessReport: ReadinessReport?
    public let lastFrameAt: Date?
    public let snapshot: CameraSnapshot?
    public let activatedAt: Date?
    public let hasCredentials: Bool
    public let version: Int

    enum CodingKeys: String, CodingKey {
        case id, name, location, vendor, model, readiness, channels, snapshot, version
        case storeId = "store_id"
        case edgeId = "edge_id"
        case streamProfile = "stream_profile"
        case analysisState = "analysis_state"
        case readinessReport = "readiness_report"
        case lastFrameAt = "last_frame_at"
        case activatedAt = "activated_at"
        case hasCredentials = "has_credentials"
    }

    // Note: the camera `address` (LAN IP/RTSP host) is intentionally not
    // decoded; the mobile responder never needs or displays it.

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        storeId = try c.decode(String.self, forKey: .storeId)
        edgeId = try c.decodeIfPresent(String.self, forKey: .edgeId)
        name = try c.decode(String.self, forKey: .name)
        location = try c.decodeIfPresent(String.self, forKey: .location)
        vendor = try c.decodeIfPresent(String.self, forKey: .vendor)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        streamProfile = try c.decodeIfPresent(String.self, forKey: .streamProfile)
        readiness = try c.decode(CameraReadiness.self, forKey: .readiness)
        analysisState = try c.decodeIfPresent(AnalysisState.self, forKey: .analysisState) ?? .unavailable
        channels = try c.decodeIfPresent([String: ChannelStatus].self, forKey: .channels) ?? [:]
        readinessReport = try c.decodeIfPresent(ReadinessReport.self, forKey: .readinessReport)
        lastFrameAt = try c.decodeIfPresent(Date.self, forKey: .lastFrameAt)
        snapshot = try c.decodeIfPresent(CameraSnapshot.self, forKey: .snapshot)
        activatedAt = try c.decodeIfPresent(Date.self, forKey: .activatedAt)
        hasCredentials = try c.decodeIfPresent(Bool.self, forKey: .hasCredentials) ?? false
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 0
    }

    /// Frame freshness: a camera whose last frame is older than `threshold` is
    /// shown as stale even when its readiness says `ready`.
    public func isFrameStale(now: Date = Date(), threshold: TimeInterval = 120) -> Bool {
        guard let lastFrameAt else { return true }
        return now.timeIntervalSince(lastFrameAt) > threshold
    }
}

public enum ZoneType: String, LenientStringEnum {
    case shelf, checkout
    case exitLine = "exit_line"
    case privacyMask = "privacy_mask"
    case unrecognized = "_unrecognized"
}

public struct Zone: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let type: ZoneType
    public let label: String?
    public let points: [[Double]]
}

public struct ZoneSet: Codable, Sendable, Equatable {
    public let version: Int
    public let zones: [Zone]
    public let acknowledgedVersion: Int?

    enum CodingKeys: String, CodingKey {
        case version, zones
        case acknowledgedVersion = "acknowledged_version"
    }
}

// MARK: - Dashboard

public struct CameraCounts: Codable, Sendable, Equatable {
    public let online: Int
    public let total: Int
}

public struct CameraHealthRow: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let readiness: CameraReadiness
    public let analysisState: AnalysisState
    public let lastFrameAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, readiness
        case analysisState = "analysis_state"
        case lastFrameAt = "last_frame_at"
    }
}

public struct TrendPoint: Codable, Sendable, Equatable, Identifiable {
    /// Calendar date `yyyy-MM-dd` in store time.
    public let date: String
    public let detections: Int
    public let reviewed: Int
    public var id: String { date }
}

public struct Dashboard: Codable, Sendable, Equatable {
    public let openAlerts: Int
    public let reviewedToday: Int
    public let cameras: CameraCounts
    /// `null` when there is not enough data; must not be displayed as zero.
    public let medianAckSeconds: Double?
    public let awaitingReview: [IncidentSummary]
    public let cameraHealth: [CameraHealthRow]
    public let trend: [TrendPoint]
    public let lastRefresh: Date?

    enum CodingKeys: String, CodingKey {
        case cameras, trend
        case openAlerts = "open_alerts"
        case reviewedToday = "reviewed_today"
        case medianAckSeconds = "median_ack_seconds"
        case awaitingReview = "awaiting_review"
        case cameraHealth = "camera_health"
        case lastRefresh = "last_refresh"
    }
}

// MARK: - Team

public struct TeamMember: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let displayName: String
    public let role: Role
    public let onDuty: Bool

    enum CodingKeys: String, CodingKey {
        case id, role
        case displayName = "display_name"
        case onDuty = "on_duty"
    }
}
