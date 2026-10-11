import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import RetailGuardCore

final class DraftTests: XCTestCase {
    private let respondPermissions: Set<String> = ["incident.read", "incident.respond"]
    private let fixedNow = date("2026-10-11T02:00:00Z")

    private func makeStore(now: Date? = nil, persistence: DraftPersistence = InMemoryDraftPersistence()) -> DraftStore {
        let instant = now ?? fixedNow
        return DraftStore(persistence: persistence, now: { instant })
    }

    private var validForm: OutcomeForm {
        OutcomeForm(outcome: .falseAlert, reason: "Customer paid at self-checkout; receipt verified",
                    observedBehavior: "Placed item in own bag before paying", lossValue: "", recoveredValue: "")
    }

    // MARK: Store

    func testSavedDraftIsFlaggedRefreshBeforeSubmit() throws {
        let store = makeStore()
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: Fixtures.storeId, baseVersion: 3, form: validForm)
        XCTAssertTrue(draft.refreshRequired)
        XCTAssertEqual(store.drafts(for: Fixtures.userId).count, 1)
        XCTAssertTrue(store.drafts(for: Fixtures.otherUserId).isEmpty, "drafts are user-scoped")

        let refreshed = try XCTUnwrap(store.recordRefresh(draftId: draft.id, currentVersion: 3))
        XCTAssertFalse(refreshed.refreshRequired)

        // Re-saving re-arms the flag and replaces rather than duplicates.
        let resaved = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                     storeId: Fixtures.storeId, baseVersion: 3, form: validForm)
        XCTAssertEqual(resaved.id, draft.id)
        XCTAssertTrue(resaved.refreshRequired)
        XCTAssertEqual(store.drafts(for: Fixtures.userId).count, 1)

        let conflicting = try XCTUnwrap(store.recordRefresh(draftId: draft.id, currentVersion: 5))
        XCTAssertTrue(conflicting.refreshRequired)
        XCTAssertEqual(conflicting.conflictingVersion, 5)

        try store.requireRefreshForAll()
        XCTAssertTrue(store.drafts(for: Fixtures.userId).allSatisfy(\.refreshRequired))
    }

    func testExpiredDraftsArePurged() throws {
        let persistence = InMemoryDraftPersistence()
        let early = makeStore(now: fixedNow, persistence: persistence)
        try early.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                       storeId: nil, baseVersion: 3, form: validForm)
        let later = makeStore(now: fixedNow.addingTimeInterval(DraftStore.defaultMaxAge + 60), persistence: persistence)
        XCTAssertTrue(later.drafts(for: Fixtures.userId).isEmpty)
        XCTAssertNil(try persistence.read(), "expired drafts are deleted, not just hidden")
    }

    func testFilePersistenceRoundTripAndSignOutClears() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("rg-drafts-\(UUID().uuidString)")
            .appendingPathComponent("drafts.json")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let store = makeStore(persistence: FileDraftPersistence(url: url))
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: Fixtures.storeId, baseVersion: 3, form: validForm)
        try store.save(userId: Fixtures.otherUserId, incidentId: "other-incident", incidentRef: "INC-2026-050",
                       storeId: nil, baseVersion: 1, form: validForm)

        let reopened = makeStore(persistence: FileDraftPersistence(url: url))
        let loaded = try XCTUnwrap(reopened.draft(incidentId: Fixtures.incidentId, userId: Fixtures.userId))
        XCTAssertEqual(loaded, draft)

        try reopened.removeAll(except: Fixtures.userId)
        XCTAssertTrue(reopened.drafts(for: Fixtures.otherUserId).isEmpty)
        XCTAssertEqual(reopened.drafts(for: Fixtures.userId).count, 1)
        try reopened.removeAll()
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }

    // MARK: Submitter

    private func submitter(_ transport: StubTransport, store: DraftStore) -> DraftSubmitter {
        DraftSubmitter(service: makeClient(transport), store: store, userId: Fixtures.userId, permissions: respondPermissions)
    }

    func testSubmitRefreshesThenPostsWithBaseVersion() async throws {
        let transport = StubTransport()
        let path = "/v1/incidents/\(Fixtures.incidentId)"
        transport.on("GET", path, json: Fixtures.incident(status: "acknowledged", version: 3))
        transport.on("POST", path + "/outcome", json: Fixtures.incident(status: "resolved", version: 4))
        let store = makeStore()
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: Fixtures.storeId, baseVersion: 3, form: validForm)

        let result = try await submitter(transport, store: store).submit(draftId: draft.id)
        XCTAssertEqual(result.status, .resolved)

        let methods = transport.recorded.map { "\($0.httpMethod!) \($0.url!.path)" }
        XCTAssertEqual(methods, ["GET \(path)", "POST \(path)/outcome"], "must GET current incident before submitting")
        let body = bodyJSON(transport.recorded[1])
        XCTAssertEqual(body["expected_version"] as? Int, 3)
        XCTAssertEqual(body["outcome"] as? String, "false_alert")
        XCTAssertEqual(body["reason"] as? String, "Customer paid at self-checkout; receipt verified")
        XCTAssertNil(body["loss_value"])
        XCTAssertTrue(store.drafts(for: Fixtures.userId).isEmpty, "draft removed after success")
    }

    func testSubmitAbortsWithConflictWhenVersionChanged() async throws {
        let transport = StubTransport()
        let path = "/v1/incidents/\(Fixtures.incidentId)"
        transport.on("GET", path, json: Fixtures.incident(status: "acknowledged", version: 5))
        let store = makeStore()
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: Fixtures.storeId, baseVersion: 3, form: validForm)
        do {
            _ = try await submitter(transport, store: store).submit(draftId: draft.id)
            XCTFail("expected conflict")
        } catch DraftSubmissionError.conflict(let current) {
            XCTAssertEqual(current.version, 5)
        }
        XCTAssertTrue(transport.requests(matching: "POST", path + "/outcome").isEmpty, "nothing may be submitted on conflict")
        let kept = try XCTUnwrap(store.draft(id: draft.id))
        XCTAssertEqual(kept.baseVersion, 3, "draft is never silently rebased")
        XCTAssertEqual(kept.conflictingVersion, 5)
        XCTAssertTrue(kept.refreshRequired)
    }

    func testServer409OnSubmitIsReportedAsConflictAndDraftKept() async throws {
        let transport = StubTransport()
        let path = "/v1/incidents/\(Fixtures.incidentId)"
        // First GET (refresh) matches; the race happens before POST.
        transport.on("GET", path, json: Fixtures.incident(status: "acknowledged", version: 3))
        transport.on("GET", path, json: Fixtures.incident(status: "resolved", assignee: Fixtures.otherUserId, version: 4))
        transport.on("POST", path + "/outcome", status: 409,
                     json: #"{"code": "version_conflict", "message": "", "request_id": "r", "retriable": false, "current_version": 4}"#)
        let store = makeStore()
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: Fixtures.storeId, baseVersion: 3, form: validForm)
        do {
            _ = try await submitter(transport, store: store).submit(draftId: draft.id)
            XCTFail("expected conflict")
        } catch DraftSubmissionError.conflict(let current) {
            XCTAssertEqual(current.version, 4)
            XCTAssertEqual(current.status, .resolved)
        }
        XCTAssertEqual(transport.requests(matching: "POST", path + "/outcome").count, 1, "no automatic retry")
        XCTAssertNotNil(store.draft(id: draft.id))
    }

    func testSubmitNotAllowedWhenAnotherResponderOwnsIncident() async throws {
        let transport = StubTransport()
        let path = "/v1/incidents/\(Fixtures.incidentId)"
        transport.on("GET", path, json: Fixtures.incident(status: "acknowledged", assignee: Fixtures.otherUserId, version: 3))
        let store = makeStore()
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: nil, baseVersion: 3, form: validForm)
        do {
            _ = try await submitter(transport, store: store).submit(draftId: draft.id)
            XCTFail("expected notAllowed")
        } catch DraftSubmissionError.notAllowed(_, let reason) {
            guard case .ownedByAnother = reason else { return XCTFail("wrong denial \(reason)") }
        }
        XCTAssertTrue(transport.requests(matching: "POST", path + "/outcome").isEmpty)
    }

    func testConfirmedDraftRejectedWhileEvidencePending() async throws {
        let transport = StubTransport()
        let path = "/v1/incidents/\(Fixtures.incidentId)"
        transport.on("GET", path, json: Fixtures.incident(status: "acknowledged", version: 3, evidence: "pending"))
        let store = makeStore()
        var form = validForm
        form.outcome = .confirmed
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: nil, baseVersion: 3, form: form)
        do {
            _ = try await submitter(transport, store: store).submit(draftId: draft.id)
            XCTFail("expected invalid")
        } catch DraftSubmissionError.invalid(let errors) {
            XCTAssertEqual(errors["outcome"], .evidencePending)
        }
        XCTAssertTrue(transport.requests(matching: "POST", path + "/outcome").isEmpty)
    }

    func testOfflineRefreshKeepsDraft() async throws {
        let transport = StubTransport()
        transport.fail("GET", "/v1/incidents/\(Fixtures.incidentId)", with: URLError(.notConnectedToInternet))
        let store = makeStore()
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: nil, baseVersion: 3, form: validForm)
        do {
            _ = try await submitter(transport, store: store).submit(draftId: draft.id)
            XCTFail("expected offline")
        } catch DraftSubmissionError.api(let error) {
            XCTAssertTrue(error.isOffline)
        }
        XCTAssertNotNil(store.draft(id: draft.id))
    }

    func testRefreshOnlyClearsFlagWhenVersionUnchanged() async throws {
        let transport = StubTransport()
        transport.on("GET", "/v1/incidents/\(Fixtures.incidentId)", json: Fixtures.incident(version: 3))
        let store = makeStore()
        let draft = try store.save(userId: Fixtures.userId, incidentId: Fixtures.incidentId, incidentRef: "INC-2026-042",
                                   storeId: nil, baseVersion: 3, form: validForm)
        let (updated, current) = try await submitter(transport, store: store).refresh(draftId: draft.id)
        XCTAssertFalse(updated.refreshRequired)
        XCTAssertEqual(current.version, 3)
    }

    func testOfflineSnapshotIsRedactedAndShortLived() throws {
        let persistence = InMemoryDraftPersistence()
        let summary = try decode(IncidentSummary.self, Fixtures.summary(status: "acknowledged", assignee: Fixtures.userId))
        OfflineSnapshotStore(persistence: persistence, now: { self.fixedNow })
            .record(userId: Fixtures.userId, storeId: Fixtures.storeId, incidents: [summary])
        let raw = String(decoding: try XCTUnwrap(persistence.read()), as: UTF8.self)
        XCTAssertFalse(raw.contains("Cosmetics aisle"), "camera names are not cached")
        XCTAssertFalse(raw.contains("Responder"), "assignee names are not cached")
        let fresh = OfflineSnapshotStore(persistence: persistence, now: { self.fixedNow.addingTimeInterval(60) })
        XCTAssertEqual(fresh.load(userId: Fixtures.userId)?.incidents.first?.assignedToMe, true)
        XCTAssertNil(fresh.load(userId: Fixtures.otherUserId))
        let stale = OfflineSnapshotStore(persistence: persistence,
                                         now: { self.fixedNow.addingTimeInterval(OfflineSnapshotStore.defaultMaxAge + 1) })
        XCTAssertNil(stale.load(userId: Fixtures.userId))
    }
}
