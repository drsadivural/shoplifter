import Foundation

/// Redacted, short-lived copy of an incident summary for the offline screen.
/// Excludes camera names, assignee identity, descriptions, evidence and media.
public struct RedactedIncidentSummary: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let ref: String
    public let storeId: String
    public let channel: IncidentChannel
    public let status: IncidentStatus
    public let capturedAt: Date
    public let version: Int
    public let assignedToMe: Bool

    public init(_ summary: IncidentSummary, userId: String) {
        id = summary.id
        ref = summary.ref
        storeId = summary.storeId
        channel = summary.channel
        status = summary.status
        capturedAt = summary.capturedAt
        version = summary.version
        assignedToMe = summary.assignee?.id == userId
    }
}

public struct OfflineSnapshot: Codable, Sendable, Equatable {
    public let userId: String
    public let storeId: String?
    public let syncedAt: Date
    public let incidents: [RedactedIncidentSummary]
}

/// Keeps the last successful inbox sync for display while offline. Snapshots
/// older than `maxAge` are discarded rather than shown.
public final class OfflineSnapshotStore: @unchecked Sendable {
    public static let defaultMaxAge: TimeInterval = 12 * 60 * 60

    private let persistence: DraftPersistence
    private let maxAge: TimeInterval
    private let now: @Sendable () -> Date

    public init(persistence: DraftPersistence, maxAge: TimeInterval = OfflineSnapshotStore.defaultMaxAge,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.persistence = persistence
        self.maxAge = maxAge
        self.now = now
    }

    public func record(userId: String, storeId: String?, incidents: [IncidentSummary], limit: Int = 25) {
        let snapshot = OfflineSnapshot(userId: userId, storeId: storeId, syncedAt: now(),
                                       incidents: incidents.prefix(limit).map { RedactedIncidentSummary($0, userId: userId) })
        if let data = try? RetailGuardJSON.makeEncoder().encode(snapshot) {
            try? persistence.write(data)
        }
    }

    public func load(userId: String) -> OfflineSnapshot? {
        guard let data = try? persistence.read(),
              let snapshot = try? RetailGuardJSON.makeDecoder().decode(OfflineSnapshot.self, from: data) else {
            return nil
        }
        guard snapshot.userId == userId, now().timeIntervalSince(snapshot.syncedAt) <= maxAge else {
            try? persistence.remove()
            return nil
        }
        return snapshot
    }

    public func clear() {
        try? persistence.remove()
    }
}
