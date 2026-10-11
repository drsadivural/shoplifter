import Foundation

public enum IncidentChannel: String, LenientStringEnum {
    case behaviorCandidate = "behavior_candidate"
    case watchlistCandidate = "watchlist_candidate"
    case checkoutException = "checkout_exception"
    case rfidException = "rfid_exception"
    case manualObservation = "manual_observation"
    case unrecognized = "_unrecognized"
}

public enum IncidentStatus: String, LenientStringEnum {
    case new, acknowledged, reviewing, resolved
    case unrecognized = "_unrecognized"
}

public enum Outcome: String, LenientStringEnum {
    case confirmed
    case falseAlert = "false_alert"
    case inconclusive
    case unrecognized = "_unrecognized"

    /// Outcomes a human reviewer may select.
    public static let selectable: [Outcome] = [.confirmed, .falseAlert, .inconclusive]
}

public enum Priority: String, LenientStringEnum {
    case normal, high, urgent
    case unrecognized = "_unrecognized"

    public static let selectable: [Priority] = [.normal, .high, .urgent]
}

public enum EvidenceState: String, LenientStringEnum {
    case pending, available, unavailable, expired
    case unrecognized = "_unrecognized"
}

public struct IncidentSummary: Codable, Sendable, Equatable, Identifiable, Hashable {
    public let id: String
    public let ref: String
    public let storeId: String
    public let storeName: String?
    public let cameraId: String?
    public let cameraName: String?
    public let channel: IncidentChannel
    public let status: IncidentStatus
    public let outcome: Outcome?
    public let priority: Priority?
    public let assignee: PersonRef?
    public let evidenceState: EvidenceState
    public let capturedAt: Date
    public let ingestedAt: Date?
    public let delayed: Bool
    public let version: Int

    public init(id: String, ref: String, storeId: String, storeName: String?, cameraId: String?, cameraName: String?,
                channel: IncidentChannel, status: IncidentStatus, outcome: Outcome?, priority: Priority?,
                assignee: PersonRef?, evidenceState: EvidenceState, capturedAt: Date, ingestedAt: Date?,
                delayed: Bool, version: Int) {
        self.id = id
        self.ref = ref
        self.storeId = storeId
        self.storeName = storeName
        self.cameraId = cameraId
        self.cameraName = cameraName
        self.channel = channel
        self.status = status
        self.outcome = outcome
        self.priority = priority
        self.assignee = assignee
        self.evidenceState = evidenceState
        self.capturedAt = capturedAt
        self.ingestedAt = ingestedAt
        self.delayed = delayed
        self.version = version
    }

    enum CodingKeys: String, CodingKey {
        case id, ref, channel, status, outcome, priority, assignee, delayed, version
        case storeId = "store_id"
        case storeName = "store_name"
        case cameraId = "camera_id"
        case cameraName = "camera_name"
        case evidenceState = "evidence_state"
        case capturedAt = "captured_at"
        case ingestedAt = "ingested_at"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        ref = try c.decodeIfPresent(String.self, forKey: .ref) ?? ""
        storeId = try c.decode(String.self, forKey: .storeId)
        storeName = try c.decodeIfPresent(String.self, forKey: .storeName)
        cameraId = try c.decodeIfPresent(String.self, forKey: .cameraId)
        cameraName = try c.decodeIfPresent(String.self, forKey: .cameraName)
        channel = try c.decode(IncidentChannel.self, forKey: .channel)
        status = try c.decode(IncidentStatus.self, forKey: .status)
        outcome = try c.decodeIfPresent(Outcome.self, forKey: .outcome)
        priority = try c.decodeIfPresent(Priority.self, forKey: .priority)
        assignee = try c.decodeIfPresent(PersonRef.self, forKey: .assignee)
        evidenceState = try c.decodeIfPresent(EvidenceState.self, forKey: .evidenceState) ?? .unavailable
        capturedAt = try c.decode(Date.self, forKey: .capturedAt)
        ingestedAt = try c.decodeIfPresent(Date.self, forKey: .ingestedAt)
        delayed = try c.decodeIfPresent(Bool.self, forKey: .delayed) ?? false
        version = try c.decode(Int.self, forKey: .version)
    }
}

public enum EvidenceKind: String, LenientStringEnum {
    case clip, frame
    case unrecognized = "_unrecognized"
}

public struct EvidenceItem: Codable, Sendable, Equatable, Identifiable, Hashable {
    public let mediaId: String
    public let mime: String
    public let sha256: String?
    public let kind: EvidenceKind
    public var id: String { mediaId }

    public init(mediaId: String, mime: String, sha256: String?, kind: EvidenceKind) {
        self.mediaId = mediaId
        self.mime = mime
        self.sha256 = sha256
        self.kind = kind
    }

    enum CodingKeys: String, CodingKey {
        case mime, sha256, kind
        case mediaId = "media_id"
    }

    public var isVideo: Bool { kind == .clip || mime.hasPrefix("video/") }

    /// File extension used for the temporary download (AVPlayer needs one).
    public var fileExtension: String {
        switch mime.lowercased() {
        case "video/mp4": return "mp4"
        case "video/quicktime": return "mov"
        case "image/jpeg": return "jpg"
        case "image/png": return "png"
        default: return isVideo ? "mp4" : "bin"
        }
    }
}

public struct IncidentNote: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let author: PersonRef?
    public let body: String
    public let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, author, body
        case createdAt = "created_at"
    }
}

public struct IncidentReview: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let actor: PersonRef?
    public let action: String
    public let outcome: Outcome?
    public let reason: String?
    public let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, actor, action, outcome, reason
        case createdAt = "created_at"
    }
}

public struct TimelineEntry: Codable, Sendable, Equatable, Hashable {
    public let at: Date
    public let action: String
    public let actor: PersonRef?
}

public struct CaseRef: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let ref: String
}

/// Full incident: `IncidentSummary` fields plus detail fields.
public struct Incident: Codable, Sendable, Equatable, Identifiable {
    public let summary: IncidentSummary
    public let description: String?
    /// Raw model outputs (e.g. `anomaly`, `item_interaction`). These are model
    /// scores, not probabilities of wrongdoing.
    public let signals: [String: JSONValue]
    public let gateReason: String?
    public let modelVersion: String?
    public let uncertainty: [String]
    public let evidence: [EvidenceItem]
    public let notes: [IncidentNote]
    public let reviews: [IncidentReview]
    public let timeline: [TimelineEntry]
    public let observedBehavior: String?
    public let lossValue: FlexibleDecimal?
    public let recoveredValue: FlexibleDecimal?
    public let currency: String?
    public let ackDeadline: Date?
    public let acknowledgedAt: Date?
    public let resolvedAt: Date?
    public let cases: [CaseRef]

    public var id: String { summary.id }
    public var version: Int { summary.version }
    public var status: IncidentStatus { summary.status }

    enum CodingKeys: String, CodingKey {
        case description, signals, uncertainty, evidence, notes, reviews, timeline, currency, cases
        case gateReason = "gate_reason"
        case modelVersion = "model_version"
        case observedBehavior = "observed_behavior"
        case lossValue = "loss_value"
        case recoveredValue = "recovered_value"
        case ackDeadline = "ack_deadline"
        case acknowledgedAt = "acknowledged_at"
        case resolvedAt = "resolved_at"
    }

    public init(from decoder: Decoder) throws {
        summary = try IncidentSummary(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        signals = try c.decodeIfPresent([String: JSONValue].self, forKey: .signals) ?? [:]
        gateReason = try c.decodeIfPresent(String.self, forKey: .gateReason)
        modelVersion = try c.decodeIfPresent(String.self, forKey: .modelVersion)
        uncertainty = try c.decodeIfPresent([String].self, forKey: .uncertainty) ?? []
        evidence = try c.decodeIfPresent([EvidenceItem].self, forKey: .evidence) ?? []
        notes = try c.decodeIfPresent([IncidentNote].self, forKey: .notes) ?? []
        reviews = try c.decodeIfPresent([IncidentReview].self, forKey: .reviews) ?? []
        timeline = try c.decodeIfPresent([TimelineEntry].self, forKey: .timeline) ?? []
        observedBehavior = try c.decodeIfPresent(String.self, forKey: .observedBehavior)
        lossValue = try c.decodeIfPresent(FlexibleDecimal.self, forKey: .lossValue)
        recoveredValue = try c.decodeIfPresent(FlexibleDecimal.self, forKey: .recoveredValue)
        currency = try c.decodeIfPresent(String.self, forKey: .currency)
        ackDeadline = try c.decodeIfPresent(Date.self, forKey: .ackDeadline)
        acknowledgedAt = try c.decodeIfPresent(Date.self, forKey: .acknowledgedAt)
        resolvedAt = try c.decodeIfPresent(Date.self, forKey: .resolvedAt)
        cases = try c.decodeIfPresent([CaseRef].self, forKey: .cases) ?? []
    }

    public func encode(to encoder: Encoder) throws {
        try summary.encode(to: encoder)
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(description, forKey: .description)
        try c.encode(signals, forKey: .signals)
        try c.encodeIfPresent(gateReason, forKey: .gateReason)
        try c.encodeIfPresent(modelVersion, forKey: .modelVersion)
        try c.encode(uncertainty, forKey: .uncertainty)
        try c.encode(evidence, forKey: .evidence)
        try c.encode(notes, forKey: .notes)
        try c.encode(reviews, forKey: .reviews)
        try c.encode(timeline, forKey: .timeline)
        try c.encodeIfPresent(observedBehavior, forKey: .observedBehavior)
        try c.encodeIfPresent(lossValue, forKey: .lossValue)
        try c.encodeIfPresent(recoveredValue, forKey: .recoveredValue)
        try c.encodeIfPresent(currency, forKey: .currency)
        try c.encodeIfPresent(ackDeadline, forKey: .ackDeadline)
        try c.encodeIfPresent(acknowledgedAt, forKey: .acknowledgedAt)
        try c.encodeIfPresent(resolvedAt, forKey: .resolvedAt)
        try c.encode(cases, forKey: .cases)
    }

    /// Numeric signals sorted by key, for display as raw model scores.
    public var numericSignals: [(key: String, value: Double)] {
        signals.compactMap { key, value in value.doubleValue.map { (key, $0) } }
            .sorted { $0.key < $1.key }
    }
}

// MARK: - Commands

public struct ExpectedVersionBody: Encodable, Sendable {
    public let expectedVersion: Int
    enum CodingKeys: String, CodingKey { case expectedVersion = "expected_version" }
}

public struct ReasonCommandBody: Encodable, Sendable {
    public let expectedVersion: Int
    public let reason: String
    enum CodingKeys: String, CodingKey {
        case reason
        case expectedVersion = "expected_version"
    }
}

public struct OutcomeCommand: Encodable, Sendable, Equatable {
    public let expectedVersion: Int
    public let outcome: Outcome
    public let reason: String
    public let observedBehavior: String?
    public let lossValue: Decimal?
    public let recoveredValue: Decimal?

    public init(expectedVersion: Int, outcome: Outcome, reason: String, observedBehavior: String?,
                lossValue: Decimal?, recoveredValue: Decimal?) {
        self.expectedVersion = expectedVersion
        self.outcome = outcome
        self.reason = reason
        self.observedBehavior = observedBehavior
        self.lossValue = lossValue
        self.recoveredValue = recoveredValue
    }

    enum CodingKeys: String, CodingKey {
        case outcome, reason
        case expectedVersion = "expected_version"
        case observedBehavior = "observed_behavior"
        case lossValue = "loss_value"
        case recoveredValue = "recovered_value"
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(expectedVersion, forKey: .expectedVersion)
        try c.encode(outcome.rawValue, forKey: .outcome)
        try c.encode(reason, forKey: .reason)
        try c.encodeIfPresent(observedBehavior, forKey: .observedBehavior)
        try c.encodeIfPresent(lossValue, forKey: .lossValue)
        try c.encodeIfPresent(recoveredValue, forKey: .recoveredValue)
    }
}

public struct EscalateCommand: Encodable, Sendable, Equatable {
    public let expectedVersion: Int
    public let reason: String
    public let priority: Priority

    public init(expectedVersion: Int, reason: String, priority: Priority) {
        self.expectedVersion = expectedVersion
        self.reason = reason
        self.priority = priority
    }

    enum CodingKeys: String, CodingKey {
        case reason, priority
        case expectedVersion = "expected_version"
    }
}

public struct NoteBody: Encodable, Sendable {
    public let body: String
}

// MARK: - Visit / POS

public struct VisitEvent: Codable, Sendable, Equatable, Hashable {
    public let cameraId: String?
    public let cameraName: String?
    public let at: Date?
    public let kind: String?

    enum CodingKeys: String, CodingKey {
        case at, kind
        case cameraId = "camera_id"
        case cameraName = "camera_name"
        case capturedAt = "captured_at"
        case action
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cameraId = try? c.decodeIfPresent(String.self, forKey: .cameraId)
        cameraName = try? c.decodeIfPresent(String.self, forKey: .cameraName)
        let at = (try? c.decodeIfPresent(Date.self, forKey: .at)) ?? nil
        let captured = (try? c.decodeIfPresent(Date.self, forKey: .capturedAt)) ?? nil
        self.at = at ?? captured
        let kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? nil
        let action = (try? c.decodeIfPresent(String.self, forKey: .action)) ?? nil
        self.kind = kind ?? action
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(cameraId, forKey: .cameraId)
        try c.encodeIfPresent(cameraName, forKey: .cameraName)
        try c.encodeIfPresent(at, forKey: .at)
        try c.encodeIfPresent(kind, forKey: .kind)
    }
}

public struct VisitTimeline: Codable, Sendable, Equatable {
    public let available: Bool
    public let reason: String?
    public let events: [VisitEvent]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        available = try c.decode(Bool.self, forKey: .available)
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
        events = try c.decodeIfPresent([VisitEvent].self, forKey: .events) ?? []
    }

    enum CodingKeys: String, CodingKey { case available, reason, events }
}

// MARK: - Notifications

public struct AppNotice: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: String
    public let incidentId: String?
    public let createdAt: Date
    public let readAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, kind
        case incidentId = "incident_id"
        case createdAt = "created_at"
        case readAt = "read_at"
    }
}
