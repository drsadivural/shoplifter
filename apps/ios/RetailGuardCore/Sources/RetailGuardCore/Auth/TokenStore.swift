import Foundation

/// A retained bearer session. Only the opaque token and metadata needed to
/// decide whether to try it are stored; never the password.
public struct StoredSession: Codable, Sendable, Equatable {
    public let token: String
    public let expiresAt: Date?
    /// Normalized API origin the token was issued by.
    public let origin: String
    public let userId: String?
    public let email: String?

    public init(token: String, expiresAt: Date?, origin: String, userId: String?, email: String?) {
        self.token = token
        self.expiresAt = expiresAt
        self.origin = origin
        self.userId = userId
        self.email = email
    }

    public func isExpired(now: Date = Date()) -> Bool {
        guard let expiresAt else { return false }
        return expiresAt <= now
    }
}

/// Secure storage for the retained session. The iOS app implements this with
/// the Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`); tests use the
/// in-memory store.
public protocol TokenStore: Sendable {
    func load() throws -> StoredSession?
    func save(_ session: StoredSession) throws
    func clear() throws
}

public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?

    public init(session: StoredSession? = nil) {
        self.session = session
    }

    public func load() throws -> StoredSession? {
        lock.lock(); defer { lock.unlock() }
        return session
    }

    public func save(_ session: StoredSession) throws {
        lock.lock(); defer { lock.unlock() }
        self.session = session
    }

    public func clear() throws {
        lock.lock(); defer { lock.unlock() }
        session = nil
    }
}

/// Thread-safe mutable box.
public final class LockedValue<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    public init(_ value: Value) {
        self.value = value
    }

    public func get() -> Value {
        lock.lock(); defer { lock.unlock() }
        return value
    }

    public func set(_ newValue: Value) {
        lock.lock(); defer { lock.unlock() }
        value = newValue
    }

    @discardableResult
    public func mutate<T>(_ body: (inout Value) -> T) -> T {
        lock.lock(); defer { lock.unlock() }
        return body(&value)
    }
}
