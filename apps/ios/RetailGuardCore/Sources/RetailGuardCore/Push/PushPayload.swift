import Foundation

/// A validated RetailGuard push notification.
///
/// Contract (CLAUDE.md / CLAUDE_CODE_JOB §4): the payload contains **only** an
/// incident ID and generic text. No face pictures, names, similarity values,
/// accusations, media URLs or evidence. The app treats push as a hint: on tap
/// it authenticates, fetches the current incident and checks permissions.
///
/// Parsing is strict allow-list: any unexpected key (top-level or in `aps`)
/// rejects the payload, so a misconfigured sender that starts leaking
/// sensitive fields is detected instead of silently displayed/routed.
public struct PushPayload: Equatable, Sendable {
    public let incidentId: String
    public let title: String?
    public let body: String?

    public enum Failure: Error, Equatable, Sendable {
        case notAnObject
        case missingIncidentId
        case invalidIncidentId
        case unexpectedKey(String)
        case unexpectedApsKey(String)
        case unexpectedAlertKey(String)
        case sensitiveText
        case mutableContentNotAllowed
    }

    static let allowedTopLevelKeys: Set<String> = ["aps", "incident_id"]
    static let allowedApsKeys: Set<String> = [
        "alert", "sound", "badge", "thread-id", "category", "interruption-level", "relevance-score",
        "content-available",
    ]
    static let allowedAlertKeys: Set<String> = [
        "title", "subtitle", "body", "title-loc-key", "title-loc-args", "loc-key", "loc-args",
    ]

    /// Parses an APNs `userInfo` dictionary.
    public static func parse(userInfo: [AnyHashable: Any]) throws -> PushPayload {
        var dictionary: [String: Any] = [:]
        for (key, value) in userInfo {
            guard let key = key as? String else { throw Failure.unexpectedKey(String(describing: key)) }
            dictionary[key] = value
        }
        return try parse(dictionary: dictionary)
    }

    /// Parses the raw APNs JSON payload.
    public static func parse(json: Data) throws -> PushPayload {
        guard let object = try? JSONSerialization.jsonObject(with: json),
              let dictionary = object as? [String: Any] else {
            throw Failure.notAnObject
        }
        return try parse(dictionary: dictionary)
    }

    static func parse(dictionary: [String: Any]) throws -> PushPayload {
        for key in dictionary.keys.sorted() where !allowedTopLevelKeys.contains(key) {
            throw Failure.unexpectedKey(key)
        }
        guard let rawId = dictionary["incident_id"] else { throw Failure.missingIncidentId }
        guard let incidentId = rawId as? String, isValidOpaqueId(incidentId) else { throw Failure.invalidIncidentId }

        var title: String?
        var body: String?
        if let aps = dictionary["aps"] {
            guard let aps = aps as? [String: Any] else { throw Failure.unexpectedApsKey("aps") }
            if aps["mutable-content"] != nil { throw Failure.mutableContentNotAllowed }
            for key in aps.keys.sorted() where !allowedApsKeys.contains(key) {
                throw Failure.unexpectedApsKey(key)
            }
            if let alert = aps["alert"] {
                if let text = alert as? String {
                    body = text
                } else if let alert = alert as? [String: Any] {
                    for key in alert.keys.sorted() where !allowedAlertKeys.contains(key) {
                        throw Failure.unexpectedAlertKey(key)
                    }
                    title = alert["title"] as? String
                    body = alert["body"] as? String
                } else {
                    throw Failure.unexpectedApsKey("alert")
                }
            }
        }
        for text in [title, body].compactMap({ $0 }) where containsSensitiveText(text) {
            throw Failure.sensitiveText
        }
        return PushPayload(incidentId: incidentId, title: title, body: body)
    }

    /// Opaque UUID-like identifiers only: 1–64 chars of `[A-Za-z0-9-_]`.
    public static func isValidOpaqueId(_ id: String) -> Bool {
        guard (1...64).contains(id.count) else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        return id.unicodeScalars.allSatisfy { allowed.contains($0) }
    }

    /// Generic text must not carry links or embedded media references.
    static func containsSensitiveText(_ text: String) -> Bool {
        let lowered = text.lowercased()
        return lowered.contains("http://") || lowered.contains("https://") || lowered.contains("data:image")
            || lowered.contains("/v1/media/")
    }
}
