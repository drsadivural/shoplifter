import XCTest
import RetailGuardCore
@testable import RetailGuard

/// App-target tests. Run on a simulator via the RetailGuard scheme
/// (`xcodebuild test`). NOT executed in the Linux authoring environment.
final class LocalizationCatalogTests: XCTestCase {
    private func strings(_ language: String) throws -> [String: String] {
        let path = try XCTUnwrap(Bundle.main.path(forResource: language, ofType: "lproj"), "missing \(language).lproj")
        let url = URL(fileURLWithPath: path).appendingPathComponent("Localizable.strings")
        let dictionary = try XCTUnwrap(NSDictionary(contentsOf: url) as? [String: String], "missing compiled catalog")
        return dictionary
    }

    func testJapaneseCatalogIsComplete() throws {
        let english = try strings("en")
        let japanese = try strings("ja")
        XCTAssertFalse(english.isEmpty)
        let missing = Set(english.keys).subtracting(japanese.keys)
        XCTAssertTrue(missing.isEmpty, "Untranslated keys: \(missing.sorted().prefix(20))")
        XCTAssertTrue(japanese.values.allSatisfy { !$0.isEmpty })
    }

    func testOverrideSwitchesLanguage() {
        Localizer.apply(.japanese)
        XCTAssertEqual(L("Sign in"), "ログイン")
        XCTAssertEqual(L("Inconclusive"), "判断保留")
        XCTAssertEqual(L("Review required"), "要確認")
        Localizer.apply(.english)
        XCTAssertEqual(L("Sign in"), "Sign in")
        Localizer.apply(.system)
    }

    func testFormatStringsKeepPlaceholders() {
        Localizer.apply(.japanese)
        XCTAssertTrue(LF("Version %@ · synchronized across devices", "3").contains("3"))
        Localizer.apply(.system)
    }
}

final class AppConfigTests: XCTestCase {
    func testDebugConfigurationIsApplied() {
        let config = AppConfig.load()
        XCTAssertEqual(config.defaultBaseURL?.scheme, "https")
        #if DEBUG
        XCTAssertEqual(config.apnsEnvironment, .sandbox)
        XCTAssertTrue(config.allowsInsecureLoopback)
        #else
        XCTAssertEqual(config.apnsEnvironment, .production)
        XCTAssertFalse(config.allowsInsecureLoopback)
        #endif
    }
}

final class KeychainTokenStoreTests: XCTestCase {
    func testRoundTripAndClear() throws {
        let store = KeychainTokenStore(service: "com.ayonix.retailguard.tests.\(UUID().uuidString)")
        defer { try? store.clear() }
        XCTAssertNil(try store.load())
        let session = StoredSession(token: "tok_test", expiresAt: Date(timeIntervalSince1970: 1_900_000_000),
                                    origin: "https://shoplifter.ayonix.com", userId: "u1", email: "a@b.example")
        try store.save(session)
        XCTAssertEqual(try store.load(), session)
        try store.clear()
        XCTAssertNil(try store.load())
    }
}

@MainActor
final class AppStateErrorTests: XCTestCase {
    private func makeState() -> AppState {
        let defaults = UserDefaults(suiteName: "rg.tests.\(UUID().uuidString)")!
        return AppState(preferences: AppPreferences(defaults: defaults), tokenStore: InMemoryTokenStore())
    }

    func testConflictIsPresentedWithCurrentVersion() {
        let state = makeState()
        let error = state.present(APIError.conflict(APIErrorBody(code: "owned_by_another_responder", message: "",
                                                                  currentVersion: 5)))
        XCTAssertEqual(error.kind, .conflict(currentVersion: 5))
    }

    func testDependencyUnavailableIsExplicit() {
        let state = makeState()
        let error = state.present(APIError.dependencyUnavailable(APIErrorBody(code: "face_sdk_unavailable", message: "")))
        XCTAssertEqual(error.kind, .unavailable(code: "face_sdk_unavailable"))
    }

    func testOfflineMarksNetworkOffline() {
        let state = makeState()
        _ = state.present(APIError.offline)
        XCTAssertFalse(state.network.isOnline)
    }
}

final class LabelTests: XCTestCase {
    func testEveryStatusHasTextAndIcon() {
        for status in IncidentStatus.allCases {
            XCTAssertFalse(status.presentation.text.isEmpty)
            XCTAssertFalse(status.presentation.systemImage.isEmpty)
        }
        for readiness in CameraReadiness.allCases {
            XCTAssertFalse(readiness.presentation.text.isEmpty)
        }
    }
}
