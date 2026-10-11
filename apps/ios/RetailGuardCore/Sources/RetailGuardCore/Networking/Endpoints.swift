import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Typed endpoint wrappers for the parts of docs/API_V1.md the iOS responder uses.
public extension APIClient {
    // MARK: Auth

    func authConfig() async throws -> AuthConfig {
        try await send(APIRequest(method: .get, path: "/v1/auth/config", authenticated: false))
    }

    /// Password login with `client: "ios"`. Wrong email or password → 401
    /// `invalid_credentials` (identical for unknown accounts).
    func login(email: String, password: String) async throws -> LoginResponse {
        try await send(.json(.post, "/v1/auth/login", body: LoginRequest(email: email, password: password),
                             authenticated: false))
    }

    func verifyMFA(_ body: MFAVerifyRequest) async throws -> AuthStateResponse {
        try await send(.json(.post, "/v1/auth/mfa/verify", body: body))
    }

    func mfaSetup() async throws -> MFASetup {
        try await send(APIRequest(method: .get, path: "/v1/auth/mfa/setup"))
    }

    func enableMFA(code: String) async throws -> AuthStateResponse {
        try await send(.json(.post, "/v1/auth/mfa/enable", body: ["code": code]))
    }

    func logout() async throws {
        _ = try await send(APIRequest(method: .post, path: "/v1/auth/logout"), as: EmptyResponse.self)
    }

    func requestPasswordReset(email: String) async throws {
        _ = try await send(.json(.post, "/v1/auth/password-reset/request", body: ["email": email],
                                 authenticated: false), as: EmptyResponse.self)
    }

    // MARK: Me

    func me() async throws -> Me {
        try await send(APIRequest(method: .get, path: "/v1/me"))
    }

    func updatePreferences(_ update: PreferencesUpdate) async throws -> Me {
        try await send(.json(.patch, "/v1/me/preferences", body: update))
    }

    func sessions() async throws -> [UserSession] {
        let page: Paged<UserSession> = try await send(APIRequest(method: .get, path: "/v1/me/sessions"))
        return page.items
    }

    func revokeSession(id: String) async throws {
        _ = try await send(APIRequest(method: .delete, path: "/v1/me/sessions/\(pathSegment(id))"),
                           as: EmptyResponse.self)
    }

    // MARK: Stores / dashboard / team

    func stores(cursor: String? = nil, limit: Int = 50) async throws -> Paged<Store> {
        try await send(APIRequest(method: .get, path: "/v1/stores", query: Self.page(cursor: cursor, limit: limit)))
    }

    func store(id: String) async throws -> Store {
        try await send(APIRequest(method: .get, path: "/v1/stores/\(pathSegment(id))"))
    }

    func dashboard(storeId: String?) async throws -> Dashboard {
        try await send(APIRequest(method: .get, path: "/v1/dashboard", query: Self.optional("store_id", storeId)))
    }

    func team(storeId: String?) async throws -> [TeamMember] {
        let page: Paged<TeamMember> = try await send(APIRequest(method: .get, path: "/v1/team",
                                                                 query: Self.optional("store_id", storeId)))
        return page.items
    }

    // MARK: Incidents

    func incidents(_ query: IncidentQuery, cursor: String? = nil) async throws -> Paged<IncidentSummary> {
        try await send(APIRequest(method: .get, path: "/v1/incidents",
                                  query: query.queryItems(forSearch: false, cursor: cursor)))
    }

    func incident(id: String) async throws -> Incident {
        try await send(APIRequest(method: .get, path: "/v1/incidents/\(pathSegment(id))"))
    }

    /// `409 owned_by_another_responder` / version conflict surface as `APIError.conflict`.
    func claim(incidentId: String, expectedVersion: Int) async throws -> Incident {
        try await send(.json(.post, "/v1/incidents/\(pathSegment(incidentId))/claim",
                             body: ExpectedVersionBody(expectedVersion: expectedVersion)))
    }

    func requestReview(incidentId: String, expectedVersion: Int, reason: String) async throws -> Incident {
        try await send(.json(.post, "/v1/incidents/\(pathSegment(incidentId))/request-review",
                             body: ReasonCommandBody(expectedVersion: expectedVersion, reason: reason)))
    }

    func recordOutcome(incidentId: String, command: OutcomeCommand) async throws -> Incident {
        try await send(.json(.post, "/v1/incidents/\(pathSegment(incidentId))/outcome", body: command))
    }

    func escalate(incidentId: String, command: EscalateCommand) async throws -> Incident {
        try await send(.json(.post, "/v1/incidents/\(pathSegment(incidentId))/escalate", body: command))
    }

    func reopen(incidentId: String, expectedVersion: Int, reason: String) async throws -> Incident {
        try await send(.json(.post, "/v1/incidents/\(pathSegment(incidentId))/reopen",
                             body: ReasonCommandBody(expectedVersion: expectedVersion, reason: reason)))
    }

    /// Notes are append-only and unversioned in the contract. The response
    /// shape is not documented, so callers refetch the incident afterwards.
    func addNote(incidentId: String, body: String) async throws {
        _ = try await send(.json(.post, "/v1/incidents/\(pathSegment(incidentId))/notes", body: NoteBody(body: body)),
                           as: EmptyResponse.self)
    }

    func visit(incidentId: String) async throws -> VisitTimeline {
        try await send(APIRequest(method: .get, path: "/v1/incidents/\(pathSegment(incidentId))/visit"))
    }

    // MARK: Search

    func search(_ query: IncidentQuery, cursor: String? = nil) async throws -> SearchResponse {
        try await send(APIRequest(method: .get, path: "/v1/search",
                                  query: query.queryItems(forSearch: true, cursor: cursor)))
    }

    /// Photo search. While the licensed face SDK is absent the server validates
    /// the image (422 on invalid) and then returns 503 `face_sdk_unavailable`.
    func photoSearch(imageData: Data, mimeType: String) async throws -> SearchResponse {
        var form = MultipartFormData()
        form.addFile(name: "file", filename: mimeType == "image/png" ? "query.png" : "query.jpg",
                     mimeType: mimeType, data: imageData)
        return try await send(APIRequest(method: .post, path: "/v1/search/photo", body: form.finalized(),
                                         contentType: form.contentType, timeout: 60))
    }

    // MARK: Media

    func mediaRequest(id: String, thumbnail: Bool) -> APIRequest {
        APIRequest(method: .get, path: "/v1/media/\(pathSegment(id))",
                   query: thumbnail ? [URLQueryItem(name: "variant", value: "thumb")] : [],
                   accept: "*/*", timeout: 120)
    }

    func mediaData(id: String, thumbnail: Bool) async throws -> Data {
        try await sendRaw(mediaRequest(id: id, thumbnail: thumbnail)).0
    }

    func downloadMedia(id: String, to destination: URL) async throws {
        _ = try await download(mediaRequest(id: id, thumbnail: false), to: destination)
    }

    // MARK: Profiles & photos

    func profiles(kind: ProfileKind, status: ProfileStatus? = nil, text: String? = nil, storeId: String? = nil,
                  cursor: String? = nil) async throws -> Paged<Profile> {
        var query = [URLQueryItem(name: "kind", value: kind.rawValue)]
        if let status { query.append(URLQueryItem(name: "status", value: status.rawValue)) }
        if let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            query.append(URLQueryItem(name: "q", value: text))
        }
        query += Self.optional("store_id", storeId)
        query += Self.page(cursor: cursor, limit: 50)
        return try await send(APIRequest(method: .get, path: "/v1/profiles", query: query))
    }

    func profile(id: String) async throws -> Profile {
        try await send(APIRequest(method: .get, path: "/v1/profiles/\(pathSegment(id))"))
    }

    func createWatchlistProfile(_ body: CreateWatchlistProfile) async throws -> Profile {
        try await send(.json(.post, "/v1/profiles", body: body))
    }

    func createStaffProfile(_ body: CreateStaffProfile) async throws -> Profile {
        try await send(.json(.post, "/v1/profiles", body: body))
    }

    func profileAction(_ action: ProfileAction, profileId: String, expectedVersion: Int, reason: String) async throws -> Profile {
        try await send(.json(.post, "/v1/profiles/\(pathSegment(profileId))/\(action.rawValue)",
                             body: ReasonCommandBody(expectedVersion: expectedVersion, reason: reason)))
    }

    func uploadPhoto(profileId: String, imageData: Data, mimeType: String, provenance: String) async throws -> Photo {
        var form = MultipartFormData()
        form.addFile(name: "file", filename: mimeType == "image/png" ? "reference.png" : "reference.jpg",
                     mimeType: mimeType, data: imageData)
        form.addField(name: "provenance", value: provenance)
        return try await send(APIRequest(method: .post, path: "/v1/profiles/\(pathSegment(profileId))/photos",
                                         body: form.finalized(), contentType: form.contentType, timeout: 120))
    }

    func reviewPhoto(profileId: String, photoId: String, approve: Bool, reason: String) async throws -> Photo {
        try await send(.json(.post, "/v1/profiles/\(pathSegment(profileId))/photos/\(pathSegment(photoId))/review",
                             body: PhotoReviewBody(decision: approve ? "approved" : "rejected", reason: reason)))
    }

    func deletePhoto(profileId: String, photoId: String) async throws {
        _ = try await send(APIRequest(method: .delete,
                                      path: "/v1/profiles/\(pathSegment(profileId))/photos/\(pathSegment(photoId))"),
                           as: EmptyResponse.self)
    }

    // MARK: Cameras

    func cameras(storeId: String?, cursor: String? = nil) async throws -> Paged<Camera> {
        try await send(APIRequest(method: .get, path: "/v1/cameras",
                                  query: Self.optional("store_id", storeId) + Self.page(cursor: cursor, limit: 100)))
    }

    func camera(id: String) async throws -> Camera {
        try await send(APIRequest(method: .get, path: "/v1/cameras/\(pathSegment(id))"))
    }

    func zones(cameraId: String) async throws -> ZoneSet {
        try await send(APIRequest(method: .get, path: "/v1/cameras/\(pathSegment(cameraId))/zones"))
    }

    // MARK: Notifications / push / support / health

    func notices(cursor: String? = nil) async throws -> Paged<AppNotice> {
        try await send(APIRequest(method: .get, path: "/v1/notifications", query: Self.page(cursor: cursor, limit: 50)))
    }

    func markNoticesRead(ids: [String]?) async throws {
        struct Body: Encodable { let ids: [String]? }
        _ = try await send(.json(.post, "/v1/notifications/read", body: Body(ids: ids)), as: EmptyResponse.self)
    }

    func registerPushDevice(_ body: PushDeviceRequest) async throws -> IdResponse {
        try await send(.json(.post, "/v1/push/devices", body: body))
    }

    func unregisterPushDevice(id: String) async throws {
        _ = try await send(APIRequest(method: .delete, path: "/v1/push/devices/\(pathSegment(id))"),
                           as: EmptyResponse.self)
    }

    func createSupportBundle(_ body: SupportBundleRequest) async throws -> SupportBundle {
        try await send(.json(.post, "/v1/support/bundles", body: body))
    }

    func systemHealth() async throws -> SystemHealth {
        try await send(APIRequest(method: .get, path: "/v1/health/system"))
    }

    // MARK: Helpers

    static func page(cursor: String?, limit: Int) -> [URLQueryItem] {
        var items = [URLQueryItem(name: "limit", value: String(max(1, min(100, limit))))]
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return items
    }

    static func optional(_ name: String, _ value: String?) -> [URLQueryItem] {
        guard let value, !value.isEmpty else { return [] }
        return [URLQueryItem(name: name, value: value)]
    }
}

/// Narrow interface used by the offline draft submitter so it can be tested
/// independently of the full client.
public protocol IncidentCommandService: Sendable {
    func incident(id: String) async throws -> Incident
    func recordOutcome(incidentId: String, command: OutcomeCommand) async throws -> Incident
}

extension APIClient: IncidentCommandService {}
