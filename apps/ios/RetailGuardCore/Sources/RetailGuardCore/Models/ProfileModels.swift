import Foundation

public enum ProfileKind: String, LenientStringEnum {
    case staff, watchlist
    case unrecognized = "_unrecognized"
}

public enum ProfileStatus: String, LenientStringEnum {
    case draft
    case pendingReview = "pending_review"
    case approved, suspended, expired, deleted
    case unrecognized = "_unrecognized"
}

public enum GalleryState: String, LenientStringEnum {
    case notInGallery = "not_in_gallery"
    case faceSDKUnavailable = "face_sdk_unavailable"
    case inGallery = "in_gallery"
    case unrecognized = "_unrecognized"
}

public enum ProfileAction: String, CaseIterable, Sendable, Identifiable {
    case submit, approve, reject, suspend, reinstate, delete

    public var id: String { rawValue }
}

public enum PhotoStatus: String, LenientStringEnum {
    case pending, approved, rejected, deleted
    case unrecognized = "_unrecognized"
}

public struct ImageQuality: Codable, Sendable, Equatable {
    public let sharpness: Double?
    public let brightness: Double?
    public let width: Int?
    public let height: Int?
}

public struct FaceQuality: Codable, Sendable, Equatable {
    /// `"unavailable"` while the licensed face SDK is absent.
    public let status: String
    public let reason: String?
    public let faceCount: Int?
    public let pose: String?

    enum CodingKeys: String, CodingKey {
        case status, reason, pose
        case faceCount = "face_count"
    }

    public var isAvailable: Bool { status != "unavailable" }
}

public struct PhotoQuality: Codable, Sendable, Equatable {
    public let image: ImageQuality?
    public let face: FaceQuality?
}

public struct Photo: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let profileId: String
    public let profileKind: ProfileKind?
    public let profileReference: String?
    public let mediaId: String
    public let thumbMediaId: String?
    public let width: Int?
    public let height: Int?
    public let status: PhotoStatus
    public let quality: PhotoQuality?
    public let provenance: String?
    public let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, width, height, status, quality, provenance
        case profileId = "profile_id"
        case profileKind = "profile_kind"
        case profileReference = "profile_reference"
        case mediaId = "media_id"
        case thumbMediaId = "thumb_media_id"
        case createdAt = "created_at"
    }
}

/// Linked incidents on a profile detail. The contract names the field but not
/// its item shape, so only `id` is required.
public struct LinkedIncident: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let ref: String?
    public let capturedAt: Date?
    public let outcome: Outcome?

    enum CodingKeys: String, CodingKey {
        case id, ref, outcome
        case capturedAt = "captured_at"
    }

    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let id = try? single.decode(String.self) {
            self.id = id
            ref = nil
            capturedAt = nil
            outcome = nil
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        ref = try c.decodeIfPresent(String.self, forKey: .ref)
        capturedAt = try? c.decodeIfPresent(Date.self, forKey: .capturedAt)
        outcome = try c.decodeIfPresent(Outcome.self, forKey: .outcome)
    }
}

public struct ProfileHistoryEntry: Codable, Sendable, Equatable {
    public let at: Date?
    public let action: String?
    public let actor: PersonRef?
    public let reason: String?

    enum CodingKeys: String, CodingKey { case at, action, actor, reason }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = (try? c.decodeIfPresent(Date.self, forKey: .at)) ?? nil
        action = try c.decodeIfPresent(String.self, forKey: .action)
        actor = (try? c.decodeIfPresent(PersonRef.self, forKey: .actor)) ?? nil
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
    }
}

public struct Profile: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let kind: ProfileKind
    public let reference: String
    public let displayName: String?
    public let basis: String?
    public let sourceIncidentId: String?
    public let storeIds: [String]
    public let status: ProfileStatus
    public let expiresAt: Date?
    public let reviewAt: Date?
    public let roleContext: String?
    public let noticeRecorded: Bool?
    public let photoCount: Int
    public let approvedPhotoCount: Int
    public let galleryState: GalleryState
    public let createdBy: PersonRef?
    public let approvedBy: PersonRef?
    public let version: Int
    public let createdAt: Date?
    // Detail-only fields (GET /v1/profiles/{id}).
    public let photos: [Photo]?
    public let linkedIncidents: [LinkedIncident]?
    public let history: [ProfileHistoryEntry]?

    enum CodingKeys: String, CodingKey {
        case id, kind, reference, basis, status, version, photos, history
        case displayName = "display_name"
        case sourceIncidentId = "source_incident_id"
        case storeIds = "store_ids"
        case expiresAt = "expires_at"
        case reviewAt = "review_at"
        case roleContext = "role_context"
        case noticeRecorded = "notice_recorded"
        case photoCount = "photo_count"
        case approvedPhotoCount = "approved_photo_count"
        case galleryState = "gallery_state"
        case createdBy = "created_by"
        case approvedBy = "approved_by"
        case createdAt = "created_at"
        case linkedIncidents = "linked_incidents"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(ProfileKind.self, forKey: .kind)
        reference = try c.decode(String.self, forKey: .reference)
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName)
        basis = try c.decodeIfPresent(String.self, forKey: .basis)
        sourceIncidentId = try c.decodeIfPresent(String.self, forKey: .sourceIncidentId)
        storeIds = try c.decodeIfPresent([String].self, forKey: .storeIds) ?? []
        status = try c.decode(ProfileStatus.self, forKey: .status)
        expiresAt = try c.decodeIfPresent(Date.self, forKey: .expiresAt)
        reviewAt = try c.decodeIfPresent(Date.self, forKey: .reviewAt)
        roleContext = try c.decodeIfPresent(String.self, forKey: .roleContext)
        noticeRecorded = try c.decodeIfPresent(Bool.self, forKey: .noticeRecorded)
        photoCount = try c.decodeIfPresent(Int.self, forKey: .photoCount) ?? 0
        approvedPhotoCount = try c.decodeIfPresent(Int.self, forKey: .approvedPhotoCount) ?? 0
        galleryState = try c.decodeIfPresent(GalleryState.self, forKey: .galleryState) ?? .notInGallery
        createdBy = try c.decodeIfPresent(PersonRef.self, forKey: .createdBy)
        approvedBy = try c.decodeIfPresent(PersonRef.self, forKey: .approvedBy)
        version = try c.decode(Int.self, forKey: .version)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
        photos = try c.decodeIfPresent([Photo].self, forKey: .photos)
        linkedIncidents = try c.decodeIfPresent([LinkedIncident].self, forKey: .linkedIncidents)
        history = try c.decodeIfPresent([ProfileHistoryEntry].self, forKey: .history)
    }

    public var title: String {
        if let displayName, !displayName.isEmpty { return displayName }
        return reference
    }

    /// Lifecycle actions offered for this status. Server enforces permissions,
    /// separation of duties (approver ≠ creator) and watchlist approval rules.
    public func availableActions(userId: String, permissions: Set<String>) -> [ProfileAction] {
        let manage = kind == .watchlist ? Permission.watchlistManage.rawValue : Permission.staffManage.rawValue
        let approvePermission = kind == .watchlist ? Permission.watchlistApprove.rawValue : Permission.staffManage.rawValue
        let canManage = permissions.contains(manage)
        let canApprove = permissions.contains(approvePermission)
        // `created_by` may be a bare user id string (decoded into displayName).
        let isCreator = createdBy?.id == userId || (createdBy?.id == nil && createdBy?.displayName == userId)
        var actions: [ProfileAction] = []
        switch status {
        case .draft:
            if canManage { actions.append(.submit) }
        case .pendingReview:
            if canApprove && !isCreator { actions.append(contentsOf: [.approve, .reject]) }
        case .approved:
            if canManage { actions.append(.suspend) }
        case .suspended:
            if canApprove { actions.append(.reinstate) }
        case .expired, .deleted, .unrecognized:
            break
        }
        if canManage && status != .deleted { actions.append(.delete) }
        return actions
    }
}

public struct CreateWatchlistProfile: Encodable, Sendable {
    public let kind = "watchlist"
    public let reference: String
    public let displayName: String?
    public let basis: String
    public let sourceIncidentId: String
    public let storeIds: [String]
    public let expiresAt: Date
    public let reviewAt: Date

    public init(reference: String, displayName: String?, basis: String, sourceIncidentId: String,
                storeIds: [String], expiresAt: Date, reviewAt: Date) {
        self.reference = reference
        self.displayName = displayName
        self.basis = basis
        self.sourceIncidentId = sourceIncidentId
        self.storeIds = storeIds
        self.expiresAt = expiresAt
        self.reviewAt = reviewAt
    }

    enum CodingKeys: String, CodingKey {
        case kind, reference, basis
        case displayName = "display_name"
        case sourceIncidentId = "source_incident_id"
        case storeIds = "store_ids"
        case expiresAt = "expires_at"
        case reviewAt = "review_at"
    }
}

public struct CreateStaffProfile: Encodable, Sendable {
    public let kind = "staff"
    public let reference: String
    public let displayName: String
    public let storeIds: [String]
    public let roleContext: String
    public let noticeRecorded: Bool
    public let expiresAt: Date

    public init(reference: String, displayName: String, storeIds: [String], roleContext: String,
                noticeRecorded: Bool, expiresAt: Date) {
        self.reference = reference
        self.displayName = displayName
        self.storeIds = storeIds
        self.roleContext = roleContext
        self.noticeRecorded = noticeRecorded
        self.expiresAt = expiresAt
    }

    enum CodingKeys: String, CodingKey {
        case kind, reference
        case displayName = "display_name"
        case storeIds = "store_ids"
        case roleContext = "role_context"
        case noticeRecorded = "notice_recorded"
        case expiresAt = "expires_at"
    }
}

public struct PhotoReviewBody: Encodable, Sendable {
    public let decision: String
    public let reason: String
}
