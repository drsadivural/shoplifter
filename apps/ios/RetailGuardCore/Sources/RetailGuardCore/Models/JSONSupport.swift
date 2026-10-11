import Foundation

/// Arbitrary JSON value for contract fields whose inner shape is open-ended
/// (e.g. incident `signals`, edge `health`, audit `detail`).
public enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public var doubleValue: Double? {
        if case .number(let value) = self { return value }
        if case .string(let value) = self { return Double(value) }
        return nil
    }

    public var stringValue: String? {
        switch self {
        case .string(let value): return value
        case .number(let value): return String(value)
        case .bool(let value): return value ? "true" : "false"
        default: return nil
        }
    }
}

/// String enum that decodes values unknown to this client as `unrecognized`
/// instead of failing the whole payload. The server may add states over time;
/// the UI shows them as an explicit "unrecognized" state, never as a known one.
public protocol LenientStringEnum: RawRepresentable, Codable, Hashable, Sendable, CaseIterable where RawValue == String {
    static var unrecognized: Self { get }
}

extension LenientStringEnum {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: raw) ?? Self.unrecognized
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

/// Reference to a person as returned by the API. The contract shows both
/// `{id, display_name}` objects and bare strings (e.g. note `author`), so both
/// forms are accepted.
public struct PersonRef: Codable, Hashable, Sendable {
    public let id: String?
    public let displayName: String

    public init(id: String?, displayName: String) {
        self.id = id
        self.displayName = displayName
    }

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
    }

    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let name = try? single.decode(String.self) {
            self.id = nil
            self.displayName = name
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decodeIfPresent(String.self, forKey: .id)
        self.displayName = try container.decodeIfPresent(String.self, forKey: .displayName) ?? (self.id ?? "")
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(id, forKey: .id)
        try container.encode(displayName, forKey: .displayName)
    }
}

/// Monetary amounts may arrive as JSON numbers or decimal strings.
public struct FlexibleDecimal: Codable, Hashable, Sendable {
    public let value: Decimal

    public init(_ value: Decimal) { self.value = value }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            guard let decimal = Decimal(string: string, locale: Locale(identifier: "en_US_POSIX")) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid decimal string")
            }
            value = decimal
        } else {
            value = try container.decode(Decimal.self)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

/// `{"items": [...], "next_cursor": "opaque" | null}`.
public struct Paged<Item: Decodable & Sendable>: Decodable, Sendable {
    public let items: [Item]
    public let nextCursor: String?

    public init(items: [Item], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }

    enum CodingKeys: String, CodingKey {
        case items
        case nextCursor = "next_cursor"
    }

    /// Accepts both the documented `{items, next_cursor}` envelope and a bare
    /// array (some list endpoints in the contract omit the envelope shape).
    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let array = try? single.decode([Item].self) {
            items = array
            nextCursor = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        items = try container.decode([Item].self, forKey: .items)
        nextCursor = try container.decodeIfPresent(String.self, forKey: .nextCursor)
    }
}

extension Paged: Equatable where Item: Equatable {}

/// Placeholder for endpoints whose body is irrelevant (e.g. `{ok: true}`).
public struct EmptyResponse: Decodable, Sendable, Equatable {
    public init() {}
    public init(from decoder: Decoder) throws {}
}

public struct OKResponse: Decodable, Sendable, Equatable {
    public let ok: Bool
}

/// Shared JSON coders configured for the RetailGuard contract.
public enum RetailGuardJSON {
    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            guard let date = RFC3339.parse(raw) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid RFC 3339 timestamp: \(raw)")
            }
            return date
        }
        return decoder
    }

    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(RFC3339.format(date))
        }
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}
