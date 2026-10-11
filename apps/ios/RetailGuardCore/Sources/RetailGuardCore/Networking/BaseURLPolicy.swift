import Foundation

/// Validates and normalizes the API origin ("company workspace").
///
/// Rules: HTTPS only; plain HTTP is accepted solely for loopback hosts and only
/// when `allowInsecureLoopback` (Debug builds). No embedded credentials, query
/// or fragment. A bare host such as `shoplifter.ayonix.com` is treated as HTTPS.
public enum BaseURLPolicy {
    public enum Failure: Error, Equatable, Sendable {
        case empty
        case malformed
        case insecureScheme
        case embeddedCredentials
        case unexpectedComponents
    }

    public static func normalize(_ input: String, allowInsecureLoopback: Bool) -> Result<URL, Failure> {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .failure(.empty) }
        let candidate = trimmed.contains("://") ? trimmed : "https://" + trimmed
        guard let components = URLComponents(string: candidate),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(), !host.isEmpty,
              !host.contains(" ") else {
            return .failure(.malformed)
        }
        if components.user != nil || components.password != nil {
            return .failure(.embeddedCredentials)
        }
        if components.query != nil || components.fragment != nil {
            return .failure(.unexpectedComponents)
        }
        let path = components.path
        if !(path.isEmpty || path == "/") {
            return .failure(.unexpectedComponents)
        }
        switch scheme {
        case "https":
            break
        case "http":
            guard allowInsecureLoopback, isLoopback(host) else { return .failure(.insecureScheme) }
        default:
            return .failure(.insecureScheme)
        }
        var normalized = URLComponents()
        normalized.scheme = scheme
        normalized.host = host
        normalized.port = components.port
        guard let url = normalized.url else { return .failure(.malformed) }
        return .success(url)
    }

    public static func isLoopback(_ host: String) -> Bool {
        let h = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        return h == "localhost" || h == "127.0.0.1" || h == "::1"
    }
}
