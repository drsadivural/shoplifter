import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum HTTPMethod: String, Sendable {
    case get = "GET", post = "POST", put = "PUT", patch = "PATCH", delete = "DELETE"
}

/// A single API request description.
public struct APIRequest: Sendable {
    public var method: HTTPMethod
    /// Absolute API path beginning with `/v1/`.
    public var path: String
    public var query: [URLQueryItem]
    public var body: Data?
    public var contentType: String?
    public var accept: String
    public var authenticated: Bool
    public var idempotencyKey: String?
    public var timeout: TimeInterval?

    public init(method: HTTPMethod, path: String, query: [URLQueryItem] = [], body: Data? = nil,
                contentType: String? = nil, accept: String = "application/json", authenticated: Bool = true,
                idempotencyKey: String? = nil, timeout: TimeInterval? = nil) {
        self.method = method
        self.path = path
        self.query = query
        self.body = body
        self.contentType = contentType
        self.accept = accept
        self.authenticated = authenticated
        self.idempotencyKey = idempotencyKey
        self.timeout = timeout
    }

    public static func json<Body: Encodable>(_ method: HTTPMethod, _ path: String, body: Body,
                                             authenticated: Bool = true) throws -> APIRequest {
        let data: Data
        do {
            data = try RetailGuardJSON.makeEncoder().encode(body)
        } catch {
            throw APIError.decoding("Request encoding failed: \(error)")
        }
        return APIRequest(method: method, path: path, body: data, contentType: "application/json",
                          authenticated: authenticated)
    }
}

/// Builds a URL path segment from an opaque identifier. IDs are never
/// constructed client-side, but they are still escaped defensively.
public func pathSegment(_ id: String) -> String {
    var allowed = CharacterSet.urlPathAllowed
    allowed.remove(charactersIn: "/?#%")
    return id.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
}

/// Observer for request lifecycle (diagnostics/last-sync bookkeeping). Never
/// receives bodies or tokens.
public protocol APIClientObserver: AnyObject, Sendable {
    func apiClient(didSucceed path: String, requestId: String?, at date: Date)
    func apiClient(didFail path: String, error: APIError)
}

/// RetailGuard v1 API client using bearer authentication.
public final class APIClient: @unchecked Sendable {
    public let baseURL: URL
    private let transport: HTTPTransport
    private let token = LockedValue<String?>(nil)
    private let userAgent: String
    private let acceptLanguage: LockedValue<String?>
    private weak var observerStorage: APIClientObserver?
    private let observerLock = NSLock()
    private let requestIdFactory: @Sendable () -> String

    public init(baseURL: URL, transport: HTTPTransport, userAgent: String = "RetailGuard-iOS",
                acceptLanguage: String? = nil,
                requestIdFactory: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() }) {
        self.baseURL = baseURL
        self.transport = transport
        self.userAgent = userAgent
        self.acceptLanguage = LockedValue(acceptLanguage)
        self.requestIdFactory = requestIdFactory
    }

    public var observer: APIClientObserver? {
        get { observerLock.lock(); defer { observerLock.unlock() }; return observerStorage }
        set { observerLock.lock(); observerStorage = newValue; observerLock.unlock() }
    }

    // MARK: Session token

    public func setToken(_ value: String?) { token.set(value) }
    public var hasToken: Bool { token.get() != nil }
    public func setAcceptLanguage(_ value: String?) { acceptLanguage.set(value) }

    // MARK: Request building

    public func makeURLRequest(_ request: APIRequest) throws -> (URLRequest, String) {
        guard request.path.hasPrefix("/") else { throw APIError.invalidBaseURL }
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidBaseURL
        }
        components.percentEncodedPath = request.path
        components.queryItems = request.query.isEmpty ? nil : request.query
        // `+` is legal in a query but servers commonly read it as a space;
        // encode it so RFC 3339 offsets and free text round-trip exactly.
        if let encodedQuery = components.percentEncodedQuery {
            components.percentEncodedQuery = encodedQuery.replacingOccurrences(of: "+", with: "%2B")
        }
        guard let url = components.url else { throw APIError.invalidBaseURL }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = request.method.rawValue
        urlRequest.httpBody = request.body
        urlRequest.cachePolicy = .reloadIgnoringLocalCacheData
        if let timeout = request.timeout { urlRequest.timeoutInterval = timeout }
        let requestId = requestIdFactory()
        urlRequest.setValue(requestId, forHTTPHeaderField: "X-Request-ID")
        urlRequest.setValue(request.accept, forHTTPHeaderField: "Accept")
        urlRequest.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        if let language = acceptLanguage.get() {
            urlRequest.setValue(language, forHTTPHeaderField: "Accept-Language")
        }
        if let contentType = request.contentType {
            urlRequest.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        if let key = request.idempotencyKey {
            urlRequest.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        }
        if request.authenticated {
            guard let bearer = token.get() else { throw APIError.notSignedIn }
            urlRequest.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        return (urlRequest, requestId)
    }

    // MARK: Sending

    /// Sends a request and decodes a JSON response.
    public func send<T: Decodable>(_ request: APIRequest, as type: T.Type = T.self) async throws -> T {
        let (data, _) = try await sendRaw(request)
        if T.self == EmptyResponse.self, let empty = EmptyResponse() as? T {
            return empty
        }
        do {
            return try RetailGuardJSON.makeDecoder().decode(T.self, from: data)
        } catch {
            let failure = APIError.decoding(String(describing: error))
            observer?.apiClient(didFail: request.path, error: failure)
            throw failure
        }
    }

    /// Sends a request and returns raw bytes for 2xx responses; maps all other
    /// outcomes to `APIError`.
    public func sendRaw(_ request: APIRequest) async throws -> (Data, HTTPURLResponse) {
        let (urlRequest, requestId) = try makeURLRequest(request)
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await transport.send(urlRequest)
        } catch {
            let failure = Self.mapTransportError(error)
            observer?.apiClient(didFail: request.path, error: failure)
            throw failure
        }
        guard (200..<300).contains(response.statusCode) else {
            let failure = Self.mapHTTPError(status: response.statusCode, data: data,
                                            fallbackRequestId: response.value(forHTTPHeaderField: "X-Request-ID") ?? requestId)
            observer?.apiClient(didFail: request.path, error: failure)
            throw failure
        }
        observer?.apiClient(didSucceed: request.path,
                            requestId: response.value(forHTTPHeaderField: "X-Request-ID") ?? requestId,
                            at: Date())
        return (data, response)
    }

    /// Downloads an authenticated resource to `destination`.
    public func download(_ request: APIRequest, to destination: URL) async throws -> HTTPURLResponse {
        let (urlRequest, requestId) = try makeURLRequest(request)
        let response: HTTPURLResponse
        let errorBody: Data?
        do {
            (response, errorBody) = try await transport.download(urlRequest, to: destination)
        } catch {
            throw Self.mapTransportError(error)
        }
        guard (200..<300).contains(response.statusCode) else {
            throw Self.mapHTTPError(status: response.statusCode, data: errorBody ?? Data(),
                                    fallbackRequestId: response.value(forHTTPHeaderField: "X-Request-ID") ?? requestId)
        }
        return response
    }

    // MARK: Error mapping

    static func mapHTTPError(status: Int, data: Data, fallbackRequestId: String?) -> APIError {
        var body = try? RetailGuardJSON.makeDecoder().decode(APIErrorBody.self, from: data)
        if body == nil, status >= 400 {
            body = APIErrorBody(code: "http_\(status)", message: "", requestId: fallbackRequestId,
                                retriable: status >= 500)
        } else if let existing = body, existing.requestId == nil {
            body = APIErrorBody(code: existing.code, message: existing.message, requestId: fallbackRequestId,
                                retriable: existing.retriable, fieldErrors: existing.fieldErrors,
                                currentVersion: existing.currentVersion)
        }
        return APIError.from(status: status, body: body)
    }

    static func mapTransportError(_ error: Error) -> APIError {
        if let apiError = error as? APIError { return apiError }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost,
                 .timedOut, .dnsLookupFailed, .dataNotAllowed, .internationalRoamingOff:
                return .offline
            default:
                return .transport(urlError.localizedDescription)
            }
        }
        return .transport(String(describing: error))
    }
}
