import Foundation
import Observation
import SwiftUI
import RetailGuardCore

enum AppTab: String, Hashable, CaseIterable {
    case home, alerts, search, history, account
}

enum MFAStage: Equatable {
    case verify
    case enroll
}

/// User-facing error derived from `APIError`.
struct UserFacingError: Error, Equatable {
    enum Kind: Equatable {
        case offline
        case sessionExpired
        case forbidden
        case notFound
        case conflict(currentVersion: Int?)
        case validation([String: String])
        case unavailable(code: String)
        case rateLimited
        case server
    }

    let kind: Kind
    let message: String
    let requestId: String?

    var isPermissionDenied: Bool { kind == .forbidden }
}

/// Session + navigation state for the whole app.
@MainActor
@Observable
final class AppState {
    enum Phase: Equatable {
        case launching
        case welcome
        case login
        case mfa(MFAStage)
        case locked
        case sessionExpired
        case onboardingFaceID
        case onboardingNotifications
        case selectStore
        case main
        /// Retained session exists but the server could not be reached at launch.
        case offlineLaunch
    }

    let config: AppConfig
    let preferences: AppPreferences
    let network = NetworkMonitor()
    let push: PushManager
    let drafts: DraftStore
    let snapshots: OfflineSnapshotStore
    private let tokenStore: TokenStore

    private(set) var api: APIClient
    private(set) var phase: Phase = .launching
    private(set) var me: Me?
    private(set) var authConfig: AuthConfig?
    private(set) var retainedSession: StoredSession?
    var selectedStoreId: String?
    var selectedTab: AppTab = .home
    var paths: [AppTab: [Route]] = [:]
    /// Inbox filter (ios-08); set from the dashboard "My assignments" tile.
    var alertFilter: AlertFilter = .all
    /// Last photo-search response (memory only; cleared on sign-out).
    var photoSearchResults: SearchResponse?
    /// Incident to open after authentication (notification tap).
    private(set) var pendingIncidentId: String?
    private(set) var lastSyncAt: Date?
    private(set) var recoveryCodes: [String] = []
    /// Bumped when the inbox should reload (foreground push, reconnect).
    private(set) var inboxRevision = 0
    private var backgroundedAt: Date?

    /// Relock after this long in the background when Face ID unlock is on.
    private let relockInterval: TimeInterval = 60

    init(config: AppConfig = .load(), preferences: AppPreferences = AppPreferences(),
         tokenStore: TokenStore = KeychainTokenStore()) {
        self.config = config
        self.preferences = preferences
        self.tokenStore = tokenStore
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("RetailGuard", isDirectory: true)
        drafts = DraftStore(persistence: FileDraftPersistence(url: support.appendingPathComponent("outcome-drafts.json")))
        snapshots = OfflineSnapshotStore(persistence: FileDraftPersistence(url: support.appendingPathComponent("inbox-snapshot.json")))
        push = PushManager(config: config, preferences: preferences)
        let origin = preferences.workspaceOrigin.flatMap { URL(string: $0) } ?? config.defaultBaseURL
            ?? URL(string: "https://invalid.invalid")!
        api = APIClient(baseURL: origin, transport: URLSessionTransport(), userAgent: config.userAgent,
                        acceptLanguage: Localizer.effectiveLanguageCode)
        push.attach(self)
        network.onReconnect = { [weak self] in self?.handleReconnect() }
    }

    // MARK: Derived

    var hasWorkspace: Bool {
        preferences.workspaceOrigin != nil || config.defaultBaseURL != nil
    }

    var workspaceDisplay: String {
        api.baseURL.host ?? api.baseURL.absoluteString
    }

    var userId: String? { me?.user.id ?? retainedSession?.userId }

    var permissions: Set<String> { me?.permissionSet ?? [] }

    func can(_ permission: Permission) -> Bool { me?.can(permission) ?? false }

    var selectedStore: StoreRef? {
        me?.store(id: selectedStoreId)
    }

    /// Store name for the screen subtitle; "All stores" when none selected.
    var storeTitle: String {
        selectedStore?.name ?? L("All stores")
    }

    func storeTime(for storeId: String?) -> StoreTime {
        me?.storeTime(for: storeId ?? selectedStoreId) ?? StoreTime(timeZoneIdentifier: nil)
    }

    func format(_ date: Date?, storeId: String?, style: StoreTime.Style = .dateTime, includeZone: Bool = false) -> String {
        guard let date else { return L("Not available") }
        return storeTime(for: storeId).format(date, style: style, locale: Localizer.locale, includeZone: includeZone)
    }

    func path(for tab: AppTab) -> Binding<[Route]> {
        Binding(get: { self.paths[tab] ?? [] }, set: { self.paths[tab] = $0 })
    }

    /// Replaces the top screen of the current tab (e.g. enroll form → created profile).
    func replaceTop(with route: Route) {
        var stack = paths[selectedTab] ?? []
        if !stack.isEmpty { stack.removeLast() }
        stack.append(route)
        paths[selectedTab] = stack
    }

    func open(_ route: Route, in tab: AppTab? = nil) {
        let target = tab ?? selectedTab
        selectedTab = target
        paths[target, default: []].append(route)
    }

    // MARK: Launch

    private var launched = false

    func launch() async {
        guard !launched else { return }
        launched = true
        EvidenceFileStore.purgeAll()
        network.start()
        push.configureCategories()
        try? drafts.requireRefreshForAll()
        guard hasWorkspace else {
            phase = .welcome
            return
        }
        let stored = try? tokenStore.load()
        if let stored, stored.origin == api.baseURL.absoluteString, !stored.isExpired() {
            retainedSession = stored
            api.setToken(stored.token)
            if preferences.faceIDEnabled, case .available = BiometricAuth.availability() {
                phase = .locked
            } else {
                await resumeSession()
            }
        } else {
            if stored != nil {
                // Expired or for another workspace: discard the token.
                try? tokenStore.clear()
                retainedSession = stored
                phase = stored?.isExpired() == true ? .sessionExpired : .login
            } else {
                phase = preferences.workspaceOrigin == nil ? .welcome : .login
            }
        }
    }

    /// Validates the retained session with `GET /v1/me`.
    func resumeSession() async {
        do {
            try await reloadMe()
            await routeAfterAuthentication()
        } catch let error as APIError {
            if error.isOffline {
                network.markOffline()
                phase = .offlineLaunch
            } else if error.requiresMFA {
                phase = .mfa(error.code == APIErrorCode.mfaEnrollmentRequired ? .enroll : .verify)
            } else {
                handleSessionExpired()
            }
        } catch {
            handleSessionExpired()
        }
    }

    // MARK: Workspace (ios-01)

    func setWorkspace(_ input: String) async -> UserFacingError? {
        switch BaseURLPolicy.normalize(input, allowInsecureLoopback: config.allowsInsecureLoopback) {
        case .failure(let failure):
            let message: String
            switch failure {
            case .empty: message = L("Enter your company workspace address.")
            case .insecureScheme: message = L("The workspace must use HTTPS.")
            case .embeddedCredentials, .unexpectedComponents, .malformed:
                message = L("Enter only the workspace address, for example shoplifter.ayonix.com.")
            }
            return UserFacingError(kind: .validation(["workspace": "invalid"]), message: message, requestId: nil)
        case .success(let url):
            let candidate = APIClient(baseURL: url, transport: URLSessionTransport(), userAgent: config.userAgent,
                                      acceptLanguage: Localizer.effectiveLanguageCode)
            do {
                authConfig = try await candidate.authConfig()
                api = candidate
                preferences.workspaceOrigin = url.absoluteString
                phase = .login
                return nil
            } catch {
                return present(error, triggerSessionFlow: false)
            }
        }
    }

    func loadAuthConfig() async {
        authConfig = try? await api.authConfig()
    }

    func changeWorkspace() {
        phase = .welcome
    }

    // MARK: Sign in (ios-02 / ios-03)

    func signIn(email: String, password: String) async -> UserFacingError? {
        api.setToken(nil)
        do {
            let response = try await api.login(email: email, password: password)
            preferences.lastEmail = email
            switch response.state {
            case .authenticated:
                guard let token = response.token else {
                    return UserFacingError(kind: .server, message: L("The server did not return a mobile session."), requestId: nil)
                }
                try persist(token: token, expiresAt: response.expiresAt, email: email)
                try await reloadMe()
                await routeAfterAuthentication()
            case .mfaRequired, .mfaEnrollmentRequired:
                guard let token = response.token else {
                    return UserFacingError(kind: .server, message: L("The server did not return a mobile session."), requestId: nil)
                }
                // Partial session: kept in memory only until MFA completes.
                api.setToken(token)
                partialToken = token
                pendingExpiry = response.expiresAt
                pendingEmail = email
                phase = .mfa(response.state == .mfaEnrollmentRequired ? .enroll : .verify)
            case .unrecognized:
                return UserFacingError(kind: .server, message: L("Unexpected sign-in response. Update the app or contact support."), requestId: nil)
            }
            return nil
        } catch {
            return present(error, triggerSessionFlow: false)
        }
    }

    private var pendingExpiry: Date?
    private var pendingEmail: String?

    func verifyMFA(code: String?, recoveryCode: String?, trustDevice: Bool) async -> UserFacingError? {
        do {
            let result = try await api.verifyMFA(MFAVerifyRequest(code: code, recoveryCode: recoveryCode, trustDevice: trustDevice))
            guard result.state == .authenticated else {
                return UserFacingError(kind: .server, message: L("Verification did not complete. Try again."), requestId: nil)
            }
            try await completeMFA()
            return nil
        } catch {
            return present(error, triggerSessionFlow: false)
        }
    }

    func mfaSetup() async throws -> MFASetup {
        try await api.mfaSetup()
    }

    /// Enables MFA during enrollment. Recovery codes are kept in memory only
    /// until the user confirms they were saved.
    func enableMFA(code: String) async -> UserFacingError? {
        do {
            let result = try await api.enableMFA(code: code)
            recoveryCodes = result.recoveryCodes ?? []
            if recoveryCodes.isEmpty {
                try await completeMFA()
            }
            return nil
        } catch {
            return present(error, triggerSessionFlow: false)
        }
    }

    func acknowledgeRecoveryCodes() async -> UserFacingError? {
        recoveryCodes = []
        do {
            try await completeMFA()
            return nil
        } catch {
            return present(error, triggerSessionFlow: false)
        }
    }

    private func completeMFA() async throws {
        if let token = currentTokenForPersistence {
            try persist(token: token, expiresAt: pendingExpiry, email: pendingEmail)
        }
        try await reloadMe()
        await routeAfterAuthentication()
    }

    /// Token held by the client during MFA (set in `signIn`).
    private var currentTokenForPersistence: String? { partialToken }
    private var partialToken: String?

    private func persist(token: String, expiresAt: Date?, email: String?) throws {
        api.setToken(token)
        partialToken = token
        let session = StoredSession(token: token, expiresAt: expiresAt, origin: api.baseURL.absoluteString,
                                    userId: nil, email: email)
        try tokenStore.save(session)
        retainedSession = session
    }

    private func reloadMe() async throws {
        let loaded = try await api.me()
        me = loaded
        network.markOnline()
        lastSyncAt = Date()
        if let session = retainedSession, session.userId != loaded.user.id {
            let updated = StoredSession(token: session.token, expiresAt: session.expiresAt ?? loaded.session.expiresAt,
                                        origin: session.origin, userId: loaded.user.id, email: loaded.user.email)
            try? tokenStore.save(updated)
            retainedSession = updated
        }
        // Drafts of other accounts on this device are discarded.
        try? drafts.removeAll(except: loaded.user.id)
        if let stored = preferences.selectedStoreId(for: loaded.user.id), loaded.store(id: stored) != nil {
            selectedStoreId = stored
        } else if loaded.stores.count == 1 {
            selectedStoreId = loaded.stores.first?.id
        } else if selectedStoreId.flatMap({ loaded.store(id: $0) }) == nil {
            selectedStoreId = nil
        }
        api.setAcceptLanguage(Localizer.effectiveLanguageCode)
    }

    func refreshMe() async {
        do { try await reloadMe() } catch { _ = present(error) }
    }

    /// Onboarding order: Face ID (ios-04) → notifications (ios-05) → store (ios-06) → main.
    func routeAfterAuthentication() async {
        partialToken = nil
        await push.refreshAuthorization()
        if !preferences.faceIDPromptAnswered, isBiometryOffered {
            phase = .onboardingFaceID
        } else if !preferences.notificationPromptAnswered, push.authorization == .notDetermined {
            phase = .onboardingNotifications
        } else if selectedStoreId == nil, (me?.stores.count ?? 0) > 1 {
            phase = .selectStore
        } else {
            enterMain()
        }
    }

    var isBiometryOffered: Bool {
        switch BiometricAuth.availability() {
        case .available, .denied, .notEnrolled, .lockedOut: return true
        case .unavailable: return false
        }
    }

    func finishFaceIDOnboarding(enabled: Bool) async {
        preferences.faceIDEnabled = enabled
        preferences.faceIDPromptAnswered = true
        await routeAfterAuthentication()
    }

    func finishNotificationOnboarding(requested: Bool) async {
        if requested { await push.requestAuthorization() }
        preferences.notificationPromptAnswered = true
        await routeAfterAuthentication()
    }

    func selectStore(_ storeId: String?) {
        selectedStoreId = storeId
        if let userId = me?.user.id { preferences.setSelectedStoreId(storeId, for: userId) }
        inboxRevision += 1
        if phase == .selectStore { enterMain() }
    }

    private func enterMain() {
        phase = .main
        Task {
            await push.registerIfAuthorized()
            await push.uploadToken()
        }
        consumePendingIncident()
    }

    // MARK: Face ID unlock

    func unlockWithBiometrics() async -> BiometricAuth.Failure? {
        let result = await BiometricAuth.authenticate(reason: L("Unlock your RetailGuard session"))
        switch result {
        case .success:
            await resumeSession()
            return nil
        case .failure(let failure):
            if failure == .fallbackToPassword || failure == .unavailable {
                // Normal sign-in stays available; the retained session is dropped.
                await signOut(keepDrafts: true, remote: false)
            }
            return failure
        }
    }

    // MARK: Session expiry & sign-out

    /// 401 `session_expired`/`authentication_required`: drop the token, keep
    /// drafts and show ios-33.
    func handleSessionExpired() {
        guard phase != .sessionExpired, phase != .login, phase != .welcome else { return }
        api.setToken(nil)
        try? tokenStore.clear()
        MediaImageCache.shared.removeAll()
        EvidenceFileStore.purgeAll()
        phase = .sessionExpired
    }

    func signOut(keepDrafts: Bool = false, remote: Bool = true) async {
        if remote {
            await push.unregister()
            try? await api.logout()
        }
        api.setToken(nil)
        try? tokenStore.clear()
        if !keepDrafts {
            try? drafts.removeAll()
            snapshots.clear()
        }
        MediaImageCache.shared.removeAll()
        EvidenceFileStore.purgeAll()
        if !keepDrafts { preferences.resetForSignOut() }
        me = nil
        photoSearchResults = nil
        retainedSession = keepDrafts ? retainedSession : nil
        paths = [:]
        selectedTab = .home
        phase = .login
    }

    func goToLogin() {
        phase = .login
    }

    // MARK: Scene phase

    func handleScenePhase(_ scenePhase: ScenePhase) {
        switch scenePhase {
        case .background:
            backgroundedAt = Date()
        case .active:
            defer { backgroundedAt = nil }
            guard phase == .main else { return }
            try? drafts.requireRefreshForAll()
            if preferences.faceIDEnabled, let since = backgroundedAt,
               Date().timeIntervalSince(since) > relockInterval,
               case .available = BiometricAuth.availability() {
                phase = .locked
                return
            }
            Task {
                await refreshMe()
                await push.refreshAuthorization()
            }
            inboxRevision += 1
        default:
            break
        }
    }

    private func handleReconnect() {
        try? drafts.requireRefreshForAll()
        inboxRevision += 1
        if phase == .offlineLaunch {
            Task { await resumeSession() }
        }
    }

    func requestInboxReload() {
        inboxRevision += 1
    }

    // MARK: Notifications (tap → authenticate → fetch → detail)

    func handleNotificationTap(incidentId: String) {
        pendingIncidentId = incidentId
        consumePendingIncident()
    }

    /// Opens the pending incident once the session is unlocked and loaded.
    /// The detail screen fetches the current incident; 403/404 there means the
    /// user may not see it and nothing is shown from the push payload.
    private func consumePendingIncident() {
        guard phase == .main, let id = pendingIncidentId else { return }
        pendingIncidentId = nil
        paths[.alerts] = [.alertDetail(id)]
        selectedTab = .alerts
    }

    // MARK: Inbox bookkeeping

    func recordInboxSync(_ items: [IncidentSummary]) {
        lastSyncAt = Date()
        if let userId = me?.user.id {
            snapshots.record(userId: userId, storeId: selectedStoreId, incidents: items)
        }
    }

    // MARK: Error presentation

    /// Maps an error for display and drives global flows (session expiry,
    /// offline). Views call this from every `catch`.
    func present(_ error: Error, triggerSessionFlow: Bool = true) -> UserFacingError {
        guard let apiError = error as? APIError else {
            return UserFacingError(kind: .server, message: L("Something went wrong. Try again."), requestId: nil)
        }
        let requestId = apiError.requestId
        switch apiError {
        case .offline:
            network.markOffline()
            return UserFacingError(kind: .offline, message: L("You're offline. Reconnect and refresh before taking action."), requestId: nil)
        case .notSignedIn:
            if triggerSessionFlow { handleSessionExpired() }
            return UserFacingError(kind: .sessionExpired, message: L("Your session has expired. Sign in again."), requestId: nil)
        case .unauthenticated(let body):
            if body.code == APIErrorCode.invalidCredentials {
                return UserFacingError(kind: .validation([:]), message: L("The email or password is incorrect."), requestId: requestId)
            }
            if body.code == APIErrorCode.invalidCode {
                return UserFacingError(kind: .validation(["code": "invalid"]), message: L("That code is not valid. Check it and try again."), requestId: requestId)
            }
            if apiError.requiresMFA {
                if triggerSessionFlow {
                    phase = .mfa(body.code == APIErrorCode.mfaEnrollmentRequired ? .enroll : .verify)
                }
                return UserFacingError(kind: .sessionExpired, message: L("Verify your sign-in to continue."), requestId: requestId)
            }
            if triggerSessionFlow { handleSessionExpired() }
            return UserFacingError(kind: .sessionExpired, message: L("Your session has expired. Sign in again."), requestId: requestId)
        case .forbidden:
            return UserFacingError(kind: .forbidden, message: L("Your role does not allow this. Ask an administrator if you need access."), requestId: requestId)
        case .notFound:
            return UserFacingError(kind: .notFound, message: L("This record is not available. It may have been removed or is outside your assigned stores."), requestId: requestId)
        case .conflict(let body):
            return UserFacingError(kind: .conflict(currentVersion: body.currentVersion), message: Self.conflictMessage(body.code), requestId: requestId)
        case .validation(let body):
            return UserFacingError(kind: .validation(body.fieldErrors ?? [:]), message: Self.validationMessage(body), requestId: requestId)
        case .payloadTooLarge:
            return UserFacingError(kind: .validation(["file": "too_large"]), message: L("The file is too large. Photos must be 8 MB or smaller."), requestId: requestId)
        case .unsupportedMedia:
            return UserFacingError(kind: .validation(["file": "unsupported"]), message: L("Unsupported file type. Use a JPEG or PNG photo."), requestId: requestId)
        case .rateLimited:
            return UserFacingError(kind: .rateLimited, message: L("Too many attempts. Wait a moment and try again."), requestId: requestId)
        case .dependencyUnavailable(let body):
            return UserFacingError(kind: .unavailable(code: body.code), message: Self.unavailableMessage(body.code), requestId: requestId)
        case .badRequest, .server:
            return UserFacingError(kind: .server, message: L("The server could not complete the request. Try again."), requestId: requestId)
        case .decoding:
            return UserFacingError(kind: .server, message: L("The server response was not understood. Update the app or contact support."), requestId: requestId)
        case .transport:
            return UserFacingError(kind: .server, message: L("A secure connection could not be established."), requestId: nil)
        case .invalidBaseURL:
            return UserFacingError(kind: .server, message: L("The workspace address is not valid."), requestId: nil)
        }
    }

    static func conflictMessage(_ code: String) -> String {
        switch code {
        case APIErrorCode.ownedByAnotherResponder:
            return L("Another responder already owns this incident. Showing the current state.")
        case APIErrorCode.evidencePending:
            return L("Evidence is still pending. Confirmed cannot be recorded until it is available.")
        case "camera_not_ready":
            return L("The camera is not ready.")
        default:
            return L("This record was updated by someone else. Showing the current state; nothing was overwritten.")
        }
    }

    static func validationMessage(_ body: APIErrorBody) -> String {
        switch body.code {
        case "weak_password": return L("Choose a stronger password.")
        default:
            if let fields = body.fieldErrors, !fields.isEmpty {
                return L("Check the highlighted fields.")
            }
            return L("Some information is missing or invalid.")
        }
    }

    static func unavailableMessage(_ code: String) -> String {
        switch code {
        case APIErrorCode.faceSDKUnavailable:
            return L("Face matching is unavailable: the licensed face SDK is not installed for your organization.")
        case APIErrorCode.modelUnavailable:
            return L("The analysis model is not installed or not validated.")
        case APIErrorCode.edgeUnavailable:
            return L("The store appliance is offline.")
        case APIErrorCode.pushUnconfigured:
            return L("Push delivery is not configured for your organization. Alerts remain available in the app.")
        case APIErrorCode.reidUnavailable:
            return L("Visit association is unavailable: cross-camera re-identification is not installed.")
        case APIErrorCode.oidcUnconfigured:
            return L("Company SSO is not configured.")
        default:
            return L("A required service is temporarily unavailable.")
        }
    }
}
