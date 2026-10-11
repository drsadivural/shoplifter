import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Minimal transport abstraction so the client can be tested with an injected
/// stub and run on Linux.
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
    /// Downloads a 2xx response body to `destination` (a file the caller owns).
    /// For non-2xx responses nothing is written and the (small) error body is
    /// returned instead. Used for evidence clips.
    func download(_ request: URLRequest, to destination: URL) async throws -> (HTTPURLResponse, Data?)
}

public extension HTTPTransport {
    func download(_ request: URLRequest, to destination: URL) async throws -> (HTTPURLResponse, Data?) {
        let (data, response) = try await send(request)
        if (200..<300).contains(response.statusCode) {
            try data.write(to: destination, options: [.atomic])
            return (response, nil)
        }
        return (response, data)
    }
}

/// `URLSession`-backed transport. Uses an ephemeral configuration: no shared
/// cookie jar, no URL cache on disk (responses carry `Cache-Control: no-store`).
public final class URLSessionTransport: HTTPTransport, @unchecked Sendable {
    private let session: URLSession

    public init(session: URLSession? = nil, timeout: TimeInterval = 30) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = timeout
            configuration.timeoutIntervalForResource = 300
            configuration.httpCookieAcceptPolicy = .never
            configuration.httpShouldSetCookies = false
            configuration.urlCache = nil
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: configuration)
        }
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            let task = session.dataTask(with: request) { data, response, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let http = response as? HTTPURLResponse {
                    continuation.resume(returning: (data ?? Data(), http))
                } else {
                    continuation.resume(throwing: URLError(.badServerResponse))
                }
            }
            task.resume()
        }
    }

    public func download(_ request: URLRequest, to destination: URL) async throws -> (HTTPURLResponse, Data?) {
        try await withCheckedThrowingContinuation { continuation in
            let task = session.downloadTask(with: request) { location, response, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let http = response as? HTTPURLResponse else {
                    continuation.resume(throwing: URLError(.badServerResponse))
                    return
                }
                do {
                    guard let location else {
                        continuation.resume(returning: (http, nil))
                        return
                    }
                    if (200..<300).contains(http.statusCode) {
                        let fm = FileManager.default
                        if fm.fileExists(atPath: destination.path) {
                            try fm.removeItem(at: destination)
                        }
                        try fm.moveItem(at: location, to: destination)
                        continuation.resume(returning: (http, nil))
                    } else {
                        let body = try? Data(contentsOf: location)
                        try? FileManager.default.removeItem(at: location)
                        continuation.resume(returning: (http, body))
                    }
                } catch {
                    continuation.resume(throwing: error)
                }
            }
            task.resume()
        }
    }
}
