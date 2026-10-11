import Foundation

/// A locally saved outcome draft. Drafts are short-lived, bound to the user and
/// the incident version they were written against, and always flagged
/// "refresh before submit": submission first re-fetches the incident and aborts
/// with a conflict if the version moved.
public struct OutcomeDraft: Codable, Sendable, Equatable, Identifiable {
    public let id: UUID
    public let userId: String
    public let incidentId: String
    public let incidentRef: String
    public let storeId: String?
    /// Incident version the draft was written against (sent as `expected_version`).
    public var baseVersion: Int
    public var form: OutcomeForm
    public let createdAt: Date
    public var updatedAt: Date
    /// True until the incident has been re-fetched after the draft was last
    /// saved/loaded and found unchanged.
    public var refreshRequired: Bool
    /// Set when a refresh found a newer version; holds that version for display.
    public var conflictingVersion: Int?

    public init(id: UUID = UUID(), userId: String, incidentId: String, incidentRef: String, storeId: String?,
                baseVersion: Int, form: OutcomeForm, createdAt: Date, updatedAt: Date,
                refreshRequired: Bool = true, conflictingVersion: Int? = nil) {
        self.id = id
        self.userId = userId
        self.incidentId = incidentId
        self.incidentRef = incidentRef
        self.storeId = storeId
        self.baseVersion = baseVersion
        self.form = form
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.refreshRequired = refreshRequired
        self.conflictingVersion = conflictingVersion
    }
}

/// Byte storage for drafts so the store can be tested in memory and the app
/// can use a protected file.
public protocol DraftPersistence: Sendable {
    func read() throws -> Data?
    func write(_ data: Data) throws
    func remove() throws
}

public final class InMemoryDraftPersistence: DraftPersistence, @unchecked Sendable {
    private let box = LockedValue<Data?>(nil)
    public init() {}
    public func read() throws -> Data? { box.get() }
    public func write(_ data: Data) throws { box.set(data) }
    public func remove() throws { box.set(nil) }
}

/// JSON file persistence. On iOS the write uses complete file protection so the
/// draft is unreadable while the device is locked.
public final class FileDraftPersistence: DraftPersistence, @unchecked Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func read() throws -> Data? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }

    public func write(_ data: Data) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: url, options: [.atomic])
        #endif
    }

    public func remove() throws {
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }
}

public final class DraftStore: @unchecked Sendable {
    public static let defaultMaxAge: TimeInterval = 24 * 60 * 60

    private let persistence: DraftPersistence
    private let maxAge: TimeInterval
    private let now: @Sendable () -> Date
    private let lock = NSLock()

    public init(persistence: DraftPersistence, maxAge: TimeInterval = DraftStore.defaultMaxAge,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.persistence = persistence
        self.maxAge = maxAge
        self.now = now
    }

    // MARK: Queries

    /// Non-expired drafts for `userId`, newest first. Expired drafts are purged.
    public func drafts(for userId: String) -> [OutcomeDraft] {
        lock.lock(); defer { lock.unlock() }
        let all = purgeExpiredLocked()
        return all.filter { $0.userId == userId }.sorted { $0.updatedAt > $1.updatedAt }
    }

    public func draft(incidentId: String, userId: String) -> OutcomeDraft? {
        drafts(for: userId).first { $0.incidentId == incidentId }
    }

    public func draft(id: UUID) -> OutcomeDraft? {
        lock.lock(); defer { lock.unlock() }
        return purgeExpiredLocked().first { $0.id == id }
    }

    // MARK: Mutations

    /// Saves (or replaces the draft for the same user + incident). Every save
    /// re-arms the "refresh before submit" flag.
    @discardableResult
    public func save(userId: String, incidentId: String, incidentRef: String, storeId: String?,
                     baseVersion: Int, form: OutcomeForm) throws -> OutcomeDraft {
        lock.lock(); defer { lock.unlock() }
        var all = purgeExpiredLocked()
        let timestamp = now()
        if let index = all.firstIndex(where: { $0.userId == userId && $0.incidentId == incidentId }) {
            all[index].form = form
            all[index].baseVersion = baseVersion
            all[index].updatedAt = timestamp
            all[index].refreshRequired = true
            all[index].conflictingVersion = nil
            try writeLocked(all)
            return all[index]
        }
        let draft = OutcomeDraft(userId: userId, incidentId: incidentId, incidentRef: incidentRef, storeId: storeId,
                                 baseVersion: baseVersion, form: form, createdAt: timestamp, updatedAt: timestamp)
        all.append(draft)
        try writeLocked(all)
        return draft
    }

    /// Records the result of a refresh: unchanged version clears the flag;
    /// a different version keeps it and stores the conflicting version.
    @discardableResult
    public func recordRefresh(draftId: UUID, currentVersion: Int) throws -> OutcomeDraft? {
        lock.lock(); defer { lock.unlock() }
        var all = purgeExpiredLocked()
        guard let index = all.firstIndex(where: { $0.id == draftId }) else { return nil }
        if all[index].baseVersion == currentVersion {
            all[index].refreshRequired = false
            all[index].conflictingVersion = nil
        } else {
            all[index].refreshRequired = true
            all[index].conflictingVersion = currentVersion
        }
        try writeLocked(all)
        return all[index]
    }

    /// Explicit user decision, after reviewing the current incident state, to
    /// re-apply the draft on top of `version`. Never called automatically.
    @discardableResult
    public func rebase(draftId: UUID, onto version: Int) throws -> OutcomeDraft? {
        lock.lock(); defer { lock.unlock() }
        var all = purgeExpiredLocked()
        guard let index = all.firstIndex(where: { $0.id == draftId }) else { return nil }
        all[index].baseVersion = version
        all[index].conflictingVersion = nil
        all[index].refreshRequired = false
        all[index].updatedAt = now()
        try writeLocked(all)
        return all[index]
    }

    /// Re-arm the refresh flag on every draft (app launch, reconnect, foreground).
    public func requireRefreshForAll() throws {
        lock.lock(); defer { lock.unlock() }
        var all = purgeExpiredLocked()
        for index in all.indices { all[index].refreshRequired = true }
        try writeLocked(all)
    }

    public func remove(id: UUID) throws {
        lock.lock(); defer { lock.unlock() }
        let all = purgeExpiredLocked().filter { $0.id != id }
        try writeLocked(all)
    }

    /// Removes all drafts (sign-out) or only those of other users (account switch).
    public func removeAll(except userId: String? = nil) throws {
        lock.lock(); defer { lock.unlock() }
        if let userId {
            try writeLocked(loadLocked().filter { $0.userId == userId })
        } else {
            try persistence.remove()
        }
    }

    // MARK: Private

    private func loadLocked() -> [OutcomeDraft] {
        guard let data = try? persistence.read(), !data.isEmpty else { return [] }
        return (try? RetailGuardJSON.makeDecoder().decode([OutcomeDraft].self, from: data)) ?? []
    }

    private func writeLocked(_ drafts: [OutcomeDraft]) throws {
        if drafts.isEmpty {
            try persistence.remove()
        } else {
            try persistence.write(try RetailGuardJSON.makeEncoder().encode(drafts))
        }
    }

    private func purgeExpiredLocked() -> [OutcomeDraft] {
        let all = loadLocked()
        let cutoff = now().addingTimeInterval(-maxAge)
        let fresh = all.filter { $0.updatedAt >= cutoff }
        if fresh.count != all.count { try? writeLocked(fresh) }
        return fresh
    }
}
