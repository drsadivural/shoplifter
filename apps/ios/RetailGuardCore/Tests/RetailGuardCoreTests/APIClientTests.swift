import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import RetailGuardCore

final class APIClientTests: XCTestCase {
    func testLoginSendsIOSClientWithoutBearer() async throws {
        let transport = StubTransport()
        transport.on("POST", "/v1/auth/login", json: #"{"state": "authenticated", "token": "tok_new", "expires_at": "2026-10-11T13:00:00Z"}"#)
        let client = makeClient(transport, token: nil)
        let response = try await client.login(email: "a@retail.example", password: "correct horse")
        XCTAssertEqual(response.token, "tok_new")
        let request = try XCTUnwrap(transport.recorded.first)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "X-CSRF-Token"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = bodyJSON(request)
        XCTAssertEqual(body["client"] as? String, "ios")
        XCTAssertEqual(body["email"] as? String, "a@retail.example")
    }

    func testAuthenticatedRequestsCarryBearerAndUniqueRequestIds() async throws {
        let transport = StubTransport()
        transport.on("GET", "/v1/me", json: Fixtures.me)
        let client = makeClient(transport)
        _ = try await client.me()
        _ = try await client.me()
        let requests = transport.recorded
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer tok_live_123")
        let ids = requests.compactMap { $0.value(forHTTPHeaderField: "X-Request-ID") }
        XCTAssertEqual(ids, ["req-1", "req-2"])
        XCTAssertEqual(requests[0].url?.absoluteString, "https://shoplifter.ayonix.com/v1/me")
    }

    func testAuthenticatedRequestWithoutTokenFailsLocally() async {
        let transport = StubTransport()
        let client = makeClient(transport, token: nil)
        do {
            _ = try await client.me()
            XCTFail("expected notSignedIn")
        } catch let error as APIError {
            XCTAssertEqual(error, .notSignedIn)
            XCTAssertTrue(error.isSessionExpired)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertTrue(transport.recorded.isEmpty, "no request may leave without a token")
    }

    func testIncidentQueryEncoding() async throws {
        let transport = StubTransport()
        transport.on("GET", "/v1/incidents", json: #"{"items": [], "next_cursor": null}"#)
        let client = makeClient(transport)
        let query = IncidentQuery(storeId: Fixtures.storeId, channel: .watchlistCandidate, status: .new,
                                  assignee: "me", from: date("2026-10-10T15:00:00Z"), to: date("2026-10-11T15:00:00Z"),
                                  limit: 500)
        _ = try await client.incidents(query, cursor: "abc+/=")
        let url = try XCTUnwrap(transport.recorded.first?.url)
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let dict = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(dict["store_id"], Fixtures.storeId)
        XCTAssertEqual(dict["channel"], "watchlist_candidate")
        XCTAssertEqual(dict["status"], "new")
        XCTAssertEqual(dict["assignee"], "me")
        XCTAssertEqual(dict["from"], "2026-10-10T15:00:00Z")
        XCTAssertEqual(dict["limit"], "100", "limit is clamped to 1...100")
        XCTAssertEqual(dict["cursor"], "abc+/=")
        XCTAssertTrue(url.absoluteString.contains("cursor=abc%2B"), "plus must be percent-encoded")
    }

    func testPathSegmentsAreEscaped() {
        XCTAssertEqual(pathSegment("abc-123"), "abc-123")
        XCTAssertEqual(pathSegment("../x?y#z"), "..%2Fx%3Fy%23z")
    }

    // MARK: Error mapping

    func testConflictCarriesCurrentVersion() async throws {
        let transport = StubTransport()
        transport.on("POST", "/v1/incidents/\(Fixtures.incidentId)/claim", status: 409,
                     json: #"{"code": "owned_by_another_responder", "message": "Incident is owned by another responder", "request_id": "r-409", "retriable": false, "current_version": 5}"#)
        let client = makeClient(transport)
        do {
            _ = try await client.claim(incidentId: Fixtures.incidentId, expectedVersion: 3)
            XCTFail("expected conflict")
        } catch let error as APIError {
            XCTAssertTrue(error.isConflict)
            XCTAssertEqual(error.code, APIErrorCode.ownedByAnotherResponder)
            XCTAssertEqual(error.currentVersion, 5)
            XCTAssertEqual(error.requestId, "r-409")
        }
        let sent = try XCTUnwrap(transport.requests(matching: "POST", "/v1/incidents/\(Fixtures.incidentId)/claim").first)
        XCTAssertEqual(bodyJSON(sent)["expected_version"] as? Int, 3)
    }

    func testSessionExpired401() async {
        let transport = StubTransport()
        transport.on("GET", "/v1/me", status: 401,
                     json: #"{"code": "session_expired", "message": "Session expired", "request_id": "r-401", "retriable": false}"#)
        do {
            _ = try await makeClient(transport).me()
            XCTFail("expected 401")
        } catch let error as APIError {
            XCTAssertTrue(error.isSessionExpired)
            XCTAssertFalse(error.requiresMFA)
            guard case .unauthenticated(let body) = error else { return XCTFail("wrong case \(error)") }
            XCTAssertEqual(body.code, "session_expired")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testMFARequired401IsNotSessionExpiry() async {
        let transport = StubTransport()
        transport.on("GET", "/v1/me", status: 401, json: #"{"code": "mfa_required", "message": "", "request_id": "r", "retriable": false}"#)
        do {
            _ = try await makeClient(transport).me()
        } catch let error as APIError {
            XCTAssertTrue(error.requiresMFA)
            XCTAssertFalse(error.isSessionExpired)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testDependencyUnavailable503ForPhotoSearch() async throws {
        let transport = StubTransport()
        transport.on("POST", "/v1/search/photo", status: 503,
                     json: #"{"code": "face_sdk_unavailable", "message": "Face SDK is not installed", "request_id": "r-503", "retriable": false}"#)
        let client = makeClient(transport)
        do {
            _ = try await client.photoSearch(imageData: Data([0xFF, 0xD8, 0xFF, 0xE0]), mimeType: "image/jpeg")
            XCTFail("expected 503")
        } catch let error as APIError {
            XCTAssertTrue(error.isDependencyUnavailable)
            XCTAssertEqual(error.code, APIErrorCode.faceSDKUnavailable)
        }
        let request = try XCTUnwrap(transport.recorded.first)
        XCTAssertTrue(request.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("multipart/form-data; boundary=") ?? false)
    }

    func testValidation422FieldErrors() async {
        let transport = StubTransport()
        transport.on("POST", "/v1/incidents/\(Fixtures.incidentId)/outcome", status: 422,
                     json: #"{"code": "validation_failed", "message": "Invalid", "request_id": "r", "retriable": false, "field_errors": {"reason": "required"}}"#)
        let command = OutcomeCommand(expectedVersion: 3, outcome: .falseAlert, reason: " ", observedBehavior: nil,
                                     lossValue: nil, recoveredValue: nil)
        do {
            _ = try await makeClient(transport).recordOutcome(incidentId: Fixtures.incidentId, command: command)
        } catch let error as APIError {
            guard case .validation = error else { return XCTFail("wrong case") }
            XCTAssertEqual(error.fieldErrors["reason"], "required")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testNonJSONErrorBodyFallsBack() async {
        let transport = StubTransport()
        transport.on("GET", "/v1/me", status: 502, json: "<html>Bad gateway</html>", headers: ["X-Request-ID": "edge-502"])
        do {
            _ = try await makeClient(transport).me()
        } catch let error as APIError {
            guard case .server(let status, let body) = error else { return XCTFail("wrong case \(error)") }
            XCTAssertEqual(status, 502)
            XCTAssertEqual(body?.code, "http_502")
            XCTAssertEqual(body?.requestId, "edge-502")
            XCTAssertEqual(body?.retriable, true)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testOfflineTransportErrorMapsToOffline() async {
        let transport = StubTransport()
        transport.fail("GET", "/v1/me", with: URLError(.notConnectedToInternet))
        do {
            _ = try await makeClient(transport).me()
        } catch let error as APIError {
            XCTAssertTrue(error.isOffline)
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testMalformedSuccessBodyIsDecodingError() async {
        let transport = StubTransport()
        transport.on("GET", "/v1/me", json: #"{"user": 1}"#)
        do {
            _ = try await makeClient(transport).me()
        } catch let error as APIError {
            guard case .decoding = error else { return XCTFail("wrong case \(error)") }
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testEmptyBodyCommandsSucceed() async throws {
        let transport = StubTransport()
        transport.on("POST", "/v1/auth/logout", json: #"{"ok": true}"#)
        transport.on("DELETE", "/v1/push/devices/dev-1", status: 204, json: "")
        let client = makeClient(transport)
        try await client.logout()
        try await client.unregisterPushDevice(id: "dev-1")
        XCTAssertEqual(transport.recorded.count, 2)
    }

    func testPushRegistrationBody() async throws {
        let transport = StubTransport()
        transport.on("POST", "/v1/push/devices", json: #"{"id": "dev-9"}"#)
        let response = try await makeClient(transport).registerPushDevice(
            PushDeviceRequest(token: "a1b2", environment: .sandbox, bundleId: "com.ayonix.retailguard.app"))
        XCTAssertEqual(response.id, "dev-9")
        let body = bodyJSON(try XCTUnwrap(transport.recorded.first))
        XCTAssertEqual(body["environment"] as? String, "sandbox")
        XCTAssertEqual(body["bundle_id"] as? String, "com.ayonix.retailguard.app")
        XCTAssertEqual(body["token"] as? String, "a1b2")
    }

    func testMediaDownloadWritesFileAndMapsErrors() async throws {
        let transport = StubTransport()
        transport.on("GET", "/v1/media/med-clip-1", json: "FAKE-MP4-BYTES", headers: ["Content-Type": "video/mp4"])
        transport.on("GET", "/v1/media/med-gone", status: 404, json: #"{"code": "not_found", "message": "", "request_id": "r", "retriable": false}"#)
        let client = makeClient(transport)
        let destination = FileManager.default.temporaryDirectory.appendingPathComponent("rg-test-\(UUID().uuidString).mp4")
        defer { try? FileManager.default.removeItem(at: destination) }
        try await client.downloadMedia(id: "med-clip-1", to: destination)
        XCTAssertEqual(try String(contentsOf: destination, encoding: .utf8), "FAKE-MP4-BYTES")
        XCTAssertEqual(transport.recorded.first?.value(forHTTPHeaderField: "Authorization"), "Bearer tok_live_123")
        do {
            try await client.downloadMedia(id: "med-gone", to: destination.appendingPathExtension("2"))
            XCTFail("expected 404")
        } catch let error as APIError {
            guard case .notFound = error else { return XCTFail("wrong case") }
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: destination.appendingPathExtension("2").path))
    }

    func testMultipartBodyLayout() {
        var form = MultipartFormData(boundary: "XYZ")
        form.addField(name: "provenance", value: "Captured in store")
        form.addFile(name: "file", filename: "ref\"erence.jpg", mimeType: "image/jpeg", data: Data([0x01, 0x02]))
        let body = form.finalized()
        let expected = Data("--XYZ\r\nContent-Disposition: form-data; name=\"provenance\"\r\n\r\nCaptured in store\r\n--XYZ\r\nContent-Disposition: form-data; name=\"file\"; filename=\"reference.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8)
            + Data([0x01, 0x02]) + Data("\r\n--XYZ--\r\n".utf8)
        XCTAssertEqual(body, expected)
        XCTAssertEqual(form.contentType, "multipart/form-data; boundary=XYZ")
    }

    // MARK: Base URL policy

    func testBaseURLPolicy() {
        XCTAssertEqual(try? BaseURLPolicy.normalize("shoplifter.ayonix.com", allowInsecureLoopback: false).get().absoluteString,
                       "https://shoplifter.ayonix.com")
        XCTAssertEqual(try? BaseURLPolicy.normalize(" https://Shoplifter.Ayonix.com/ ", allowInsecureLoopback: false).get().absoluteString,
                       "https://shoplifter.ayonix.com")
        XCTAssertEqual(BaseURLPolicy.normalize("http://shoplifter.ayonix.com", allowInsecureLoopback: true), .failure(.insecureScheme))
        XCTAssertEqual(BaseURLPolicy.normalize("http://localhost:8000", allowInsecureLoopback: false), .failure(.insecureScheme))
        XCTAssertEqual(try? BaseURLPolicy.normalize("http://127.0.0.1:8000", allowInsecureLoopback: true).get().absoluteString,
                       "http://127.0.0.1:8000")
        XCTAssertEqual(BaseURLPolicy.normalize("https://user:pw@host.example", allowInsecureLoopback: false), .failure(.embeddedCredentials))
        XCTAssertEqual(BaseURLPolicy.normalize("https://host.example/api?x=1", allowInsecureLoopback: false), .failure(.unexpectedComponents))
        XCTAssertEqual(BaseURLPolicy.normalize("", allowInsecureLoopback: false), .failure(.empty))
        XCTAssertEqual(BaseURLPolicy.normalize("ftp://host.example", allowInsecureLoopback: false), .failure(.insecureScheme))
    }
}
