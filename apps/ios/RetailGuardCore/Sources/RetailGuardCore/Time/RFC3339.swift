import Foundation

/// RFC 3339 timestamp handling. The API always sends UTC (`2026-10-11T01:42:18Z`),
/// optionally with fractional seconds. A few fields (e.g. profile expiry) may be
/// date-only; those are interpreted as midnight UTC.
public enum RFC3339 {
    private static let lock = NSLock()
    nonisolated(unsafe) private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()
    nonisolated(unsafe) private static let fractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    nonisolated(unsafe) private static let dateOnly: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    public static func parse(_ string: String) -> Date? {
        let trimmed = string.trimmingCharacters(in: .whitespaces)
        lock.lock()
        defer { lock.unlock() }
        if let date = plain.date(from: trimmed) { return date }
        if let date = fractional.date(from: trimmed) { return date }
        if trimmed.count == 10, let date = dateOnly.date(from: trimmed) { return date }
        return nil
    }

    /// Formats as UTC with a `Z` suffix and whole seconds.
    public static func format(_ date: Date) -> String {
        lock.lock()
        defer { lock.unlock() }
        return plain.string(from: date)
    }
}
