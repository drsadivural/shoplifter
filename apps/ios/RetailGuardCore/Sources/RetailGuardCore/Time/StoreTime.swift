import Foundation

/// Converts API UTC instants into the **store** timezone for display and turns
/// store-local calendar days into UTC query bounds. The device timezone is never
/// used implicitly: a responder travelling between stores must see store time.
public struct StoreTime: Sendable, Equatable {
    public let timeZone: TimeZone

    /// Falls back to `fallbackIdentifier` (usually the org timezone), then UTC,
    /// when the store timezone identifier is missing or unknown.
    public init(timeZoneIdentifier: String?, fallbackIdentifier: String? = nil) {
        if let id = timeZoneIdentifier, let zone = TimeZone(identifier: id) {
            timeZone = zone
        } else if let id = fallbackIdentifier, let zone = TimeZone(identifier: id) {
            timeZone = zone
        } else {
            timeZone = TimeZone(secondsFromGMT: 0)!
        }
    }

    public enum Style: Sendable {
        /// Locale-aware date + time (short date, minutes).
        case dateTime
        /// Locale-aware date only.
        case date
        /// Locale-aware time with seconds (incident timestamps).
        case timeWithSeconds
        /// Locale-aware hour:minute.
        case time
        /// Fixed `yyyy-MM-dd HH:mm:ss` (evidence overlays, diagnostics).
        case evidence
    }

    public var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    public func format(_ date: Date, style: Style, locale: Locale = .current, includeZone: Bool = false) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = timeZone
        switch style {
        case .dateTime:
            formatter.setLocalizedDateFormatFromTemplate(includeZone ? "yMMMdjmmz" : "yMMMdjmm")
        case .date:
            formatter.setLocalizedDateFormatFromTemplate("yMMMd")
        case .timeWithSeconds:
            formatter.setLocalizedDateFormatFromTemplate(includeZone ? "jmmssz" : "jmmss")
        case .time:
            formatter.setLocalizedDateFormatFromTemplate("jmm")
        case .evidence:
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = includeZone ? "yyyy-MM-dd HH:mm:ss zzz" : "yyyy-MM-dd HH:mm:ss"
        }
        return formatter.string(from: date)
    }

    /// Store-local calendar day `[start, nextStart)` containing `date`.
    public func dayBounds(containing date: Date) -> (start: Date, end: Date) {
        let cal = calendar
        let start = cal.startOfDay(for: date)
        let end = cal.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)
        return (start, end)
    }

    /// UTC RFC 3339 `from`/`to` query bounds covering the store-local days from
    /// `firstDay` through `lastDay` inclusive.
    public func queryRange(firstDay: Date, lastDay: Date) -> (from: String, to: String) {
        let lower = min(firstDay, lastDay)
        let upper = max(firstDay, lastDay)
        let start = dayBounds(containing: lower).start
        let end = dayBounds(containing: upper).end
        return (RFC3339.format(start), RFC3339.format(end))
    }

    /// Builds a store-local wall-clock instant (e.g. profile expiry at end of day).
    public func endOfDay(_ date: Date) -> Date {
        dayBounds(containing: date).end.addingTimeInterval(-1)
    }

    /// `HH:mm` string in store-local time (quiet hours use this form).
    public static func hourMinute(from components: DateComponents) -> String? {
        guard let hour = components.hour, let minute = components.minute,
              (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        return String(format: "%02d:%02d", hour, minute)
    }

    public static func components(fromHourMinute string: String) -> DateComponents? {
        let parts = string.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        return DateComponents(hour: hour, minute: minute)
    }
}
