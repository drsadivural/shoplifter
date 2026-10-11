import Foundation
import XCTest
@testable import RetailGuardCore

final class StoreTimeTests: XCTestCase {
    func testRFC3339ParsingVariants() {
        XCTAssertEqual(RFC3339.parse("2026-10-11T01:42:18Z")?.timeIntervalSince1970, 1_791_682_938)
        XCTAssertEqual(RFC3339.parse("2026-10-11T01:42:18.250Z")!.timeIntervalSince1970, 1_791_682_938.25, accuracy: 0.001)
        XCTAssertEqual(RFC3339.parse("2026-10-11T10:42:18+09:00"), RFC3339.parse("2026-10-11T01:42:18Z"))
        XCTAssertEqual(RFC3339.parse("2027-04-10"), RFC3339.parse("2027-04-10T00:00:00Z"))
        XCTAssertNil(RFC3339.parse("11/10/2026 10:42"))
        XCTAssertNil(RFC3339.parse(""))
        XCTAssertEqual(RFC3339.format(date("2026-10-11T01:42:18Z")), "2026-10-11T01:42:18Z")
    }

    func testFormatsInStoreTimezoneNotDevice() {
        let tokyo = StoreTime(timeZoneIdentifier: "Asia/Tokyo")
        let instant = date("2026-10-11T01:42:18Z")
        XCTAssertEqual(tokyo.format(instant, style: .evidence), "2026-10-11 10:42:18")
        // Crossing midnight: 15:30 UTC is 00:30 next day in Tokyo.
        XCTAssertEqual(tokyo.format(date("2026-10-10T15:30:00Z"), style: .evidence), "2026-10-11 00:30:00")
        let english = tokyo.format(instant, style: .timeWithSeconds, locale: Locale(identifier: "en_US"))
        XCTAssertTrue(english.contains("10:42:18"), english)
        let japanese = tokyo.format(instant, style: .timeWithSeconds, locale: Locale(identifier: "ja_JP"))
        XCTAssertTrue(japanese.contains("10:42:18"), japanese)
        let jaDate = tokyo.format(instant, style: .date, locale: Locale(identifier: "ja_JP"))
        XCTAssertTrue(jaDate.contains("2026") && jaDate.contains("10") && jaDate.contains("11"), jaDate)
        // Same instant shown for a store in UTC.
        XCTAssertEqual(StoreTime(timeZoneIdentifier: "UTC").format(instant, style: .evidence), "2026-10-11 01:42:18")
    }

    func testUnknownTimezoneFallsBackToOrgThenUTC() {
        XCTAssertEqual(StoreTime(timeZoneIdentifier: "Mars/Olympus", fallbackIdentifier: "Asia/Tokyo").timeZone.identifier, "Asia/Tokyo")
        XCTAssertEqual(StoreTime(timeZoneIdentifier: nil, fallbackIdentifier: nil).timeZone.secondsFromGMT(), 0)
    }

    func testStoreLocalDayRangeConvertsToUTCBounds() {
        let tokyo = StoreTime(timeZoneIdentifier: "Asia/Tokyo")
        // 2026-10-11 10:42 JST → store day 2026-10-11 → [10-10T15:00Z, 10-11T15:00Z)
        let bounds = tokyo.dayBounds(containing: date("2026-10-11T01:42:18Z"))
        XCTAssertEqual(RFC3339.format(bounds.start), "2026-10-10T15:00:00Z")
        XCTAssertEqual(RFC3339.format(bounds.end), "2026-10-11T15:00:00Z")
        let range = tokyo.queryRange(firstDay: date("2026-10-11T01:00:00Z"), lastDay: date("2026-10-05T01:00:00Z"))
        XCTAssertEqual(range.from, "2026-10-04T15:00:00Z")
        XCTAssertEqual(range.to, "2026-10-11T15:00:00Z")
        XCTAssertEqual(RFC3339.format(tokyo.endOfDay(date("2026-10-11T01:00:00Z"))), "2026-10-11T14:59:59Z")
    }

    func testQuietHoursHelpers() {
        XCTAssertEqual(StoreTime.hourMinute(from: DateComponents(hour: 7, minute: 5)), "07:05")
        XCTAssertNil(StoreTime.hourMinute(from: DateComponents(hour: 24, minute: 0)))
        XCTAssertEqual(StoreTime.components(fromHourMinute: "22:00"), DateComponents(hour: 22, minute: 0))
        XCTAssertNil(StoreTime.components(fromHourMinute: "7pm"))
    }
}

final class IncidentActionsTests: XCTestCase {
    private let responder: Set<String> = ["incident.read", "incident.respond"]
    private let viewer: Set<String> = ["incident.read"]
    private let me = PersonRef(id: Fixtures.userId, displayName: "Aiko")
    private let other = PersonRef(id: Fixtures.otherUserId, displayName: "Ken")

    private func ctx(_ status: IncidentStatus, _ assignee: PersonRef?, perms: Set<String>? = nil,
                     evidence: EvidenceState = .available, version: Int = 3, latest: Int? = nil) -> IncidentActionContext {
        IncidentActionContext(status: status, assignee: assignee, evidenceState: evidence, version: version,
                              userId: Fixtures.userId, permissions: perms ?? responder, knownLatestVersion: latest)
    }

    func testNewUnassignedIncident() {
        XCTAssertEqual(IncidentActions.allowed(ctx(.new, nil)), [.claim, .escalate, .addNote])
        XCTAssertEqual(IncidentActions.denial(for: .recordOutcome, ctx(.new, nil)), .claimRequired)
    }

    func testAcknowledgedByMe() {
        XCTAssertEqual(IncidentActions.allowed(ctx(.acknowledged, me)), [.requestReview, .recordOutcome, .escalate, .addNote])
        XCTAssertEqual(IncidentActions.denial(for: .claim, ctx(.acknowledged, me)), .alreadyOwned)
    }

    func testReviewingByMe() {
        XCTAssertEqual(IncidentActions.allowed(ctx(.reviewing, me)), [.recordOutcome, .escalate, .addNote])
        XCTAssertEqual(IncidentActions.denial(for: .requestReview, ctx(.reviewing, me)), .notAvailableInStatus(.reviewing))
    }

    func testOwnedByAnotherResponderNeverOverwritten() {
        let context = ctx(.acknowledged, other)
        XCTAssertEqual(IncidentActions.allowed(context), [.addNote])
        XCTAssertEqual(IncidentActions.denial(for: .claim, context), .ownedByAnother(other))
        XCTAssertEqual(IncidentActions.denial(for: .recordOutcome, context), .ownedByAnother(other))
        XCTAssertEqual(IncidentActions.denial(for: .escalate, context), .ownedByAnother(other))
    }

    func testResolvedIncident() {
        XCTAssertEqual(IncidentActions.allowed(ctx(.resolved, me)), [.addNote])
        XCTAssertEqual(IncidentActions.allowed(ctx(.resolved, me, perms: responder.union(["incident.reopen"]))), [.reopen, .addNote])
        XCTAssertEqual(IncidentActions.denial(for: .reopen, ctx(.new, nil, perms: ["incident.reopen", "incident.respond"])), .notResolved)
    }

    func testViewerHasNoMutations() {
        XCTAssertTrue(IncidentActions.allowed(ctx(.new, nil, perms: viewer)).isEmpty)
        XCTAssertEqual(IncidentActions.denial(for: .claim, ctx(.new, nil, perms: viewer)), .missingPermission("incident.respond"))
    }

    func testStaleVersionBlocksTransitionsUntilRefresh() {
        let stale = ctx(.acknowledged, me, version: 3, latest: 5)
        XCTAssertEqual(IncidentActions.allowed(stale), [.addNote])
        XCTAssertEqual(IncidentActions.denial(for: .recordOutcome, stale), .staleVersion(local: 3, latest: 5))
        XCTAssertEqual(IncidentActions.allowed(ctx(.acknowledged, me, version: 5, latest: 5)).contains(.recordOutcome), true)
    }

    func testUnrecognizedStatusOffersNothing() {
        XCTAssertTrue(IncidentActions.allowed(ctx(.unrecognized, nil)).isEmpty)
    }

    func testSelectableOutcomesDependOnEvidence() {
        XCTAssertEqual(IncidentActions.selectableOutcomes(evidenceState: .available), [.confirmed, .falseAlert, .inconclusive])
        XCTAssertEqual(IncidentActions.selectableOutcomes(evidenceState: .pending), [.falseAlert, .inconclusive])
    }

    func testOutcomeFormValidation() {
        var form = OutcomeForm()
        XCTAssertEqual(form.validate(evidenceState: .available), ["outcome": .outcomeRequired, "reason": .reasonRequired])
        form.outcome = .confirmed
        form.reason = "  Observed concealment on clip and at exit  "
        form.lossValue = "1,980"
        XCTAssertEqual(form.validate(evidenceState: .available), [:])
        XCTAssertEqual(form.validate(evidenceState: .pending), ["outcome": .evidencePending])
        let command = form.command(expectedVersion: 7)
        XCTAssertEqual(command?.expectedVersion, 7)
        XCTAssertEqual(command?.reason, "Observed concealment on clip and at exit")
        XCTAssertEqual(command?.lossValue, Decimal(1980), "comma before three digits is grouping")
        XCTAssertEqual(OutcomeForm.parseAmount("12,5"), Decimal(string: "12.5"), "comma before 1-2 trailing digits is decimal")
        form.lossValue = "-5"
        XCTAssertEqual(form.validate(evidenceState: .available)["loss_value"], .invalidAmount)
        XCTAssertEqual(OutcomeForm.parseAmount("1980.50"), Decimal(string: "1980.5"))
        XCTAssertEqual(OutcomeForm.parseAmount("1,980.50"), Decimal(string: "1980.5"))
        XCTAssertNil(OutcomeForm.parseAmount("12.345"))
        XCTAssertNil(OutcomeForm.parseAmount("abc"))
    }
}

final class PushPayloadTests: XCTestCase {
    func testParsesMinimalGenericPayload() throws {
        let json = #"{"aps": {"alert": {"title": "RetailGuard", "body": "New alert requires review"}, "sound": "default", "thread-id": "incidents"}, "incident_id": "c0ffee00-1111-4222-8333-444455556666"}"#
        let payload = try PushPayload.parse(json: Data(json.utf8))
        XCTAssertEqual(payload.incidentId, Fixtures.incidentId)
        XCTAssertEqual(payload.title, "RetailGuard")
        XCTAssertEqual(payload.body, "New alert requires review")
    }

    func testParsesUserInfoDictionary() throws {
        let userInfo: [AnyHashable: Any] = ["aps": ["alert": "New alert requires review"], "incident_id": "abc-123"]
        XCTAssertEqual(try PushPayload.parse(userInfo: userInfo).incidentId, "abc-123")
    }

    func testRejectsExtraSensitiveTopLevelKeys() {
        for key in ["face_image_url", "subject_name", "similarity", "media_id", "camera_name", "description"] {
            let json = #"{"aps": {"alert": "New alert"}, "incident_id": "abc-123", "\#(key)": "x"}"#
            XCTAssertThrowsError(try PushPayload.parse(json: Data(json.utf8)), key) { error in
                XCTAssertEqual(error as? PushPayload.Failure, .unexpectedKey(key))
            }
        }
    }

    func testRejectsMediaAttachmentsAndUnknownApsKeys() {
        let mutable = #"{"aps": {"alert": "New alert", "mutable-content": 1}, "incident_id": "abc-123"}"#
        XCTAssertThrowsError(try PushPayload.parse(json: Data(mutable.utf8))) {
            XCTAssertEqual($0 as? PushPayload.Failure, .mutableContentNotAllowed)
        }
        let launchImage = #"{"aps": {"alert": {"body": "x", "launch-image": "face.png"}}, "incident_id": "abc-123"}"#
        XCTAssertThrowsError(try PushPayload.parse(json: Data(launchImage.utf8))) {
            XCTAssertEqual($0 as? PushPayload.Failure, .unexpectedAlertKey("launch-image"))
        }
        let extraAps = #"{"aps": {"alert": "x", "attachment-url": "https://cdn/x.jpg"}, "incident_id": "abc-123"}"#
        XCTAssertThrowsError(try PushPayload.parse(json: Data(extraAps.utf8))) {
            XCTAssertEqual($0 as? PushPayload.Failure, .unexpectedApsKey("attachment-url"))
        }
    }

    func testRejectsLinksInText() {
        let json = #"{"aps": {"alert": {"body": "See https://example.com/v1/media/abc"}}, "incident_id": "abc-123"}"#
        XCTAssertThrowsError(try PushPayload.parse(json: Data(json.utf8))) {
            XCTAssertEqual($0 as? PushPayload.Failure, .sensitiveText)
        }
    }

    func testRejectsMissingOrMalformedIncidentId() {
        XCTAssertThrowsError(try PushPayload.parse(json: Data(#"{"aps": {"alert": "x"}}"#.utf8))) {
            XCTAssertEqual($0 as? PushPayload.Failure, .missingIncidentId)
        }
        XCTAssertThrowsError(try PushPayload.parse(json: Data(#"{"incident_id": "../../etc"}"#.utf8))) {
            XCTAssertEqual($0 as? PushPayload.Failure, .invalidIncidentId)
        }
        XCTAssertThrowsError(try PushPayload.parse(json: Data(#"{"incident_id": 42}"#.utf8))) {
            XCTAssertEqual($0 as? PushPayload.Failure, .invalidIncidentId)
        }
        XCTAssertThrowsError(try PushPayload.parse(json: Data("[]".utf8))) {
            XCTAssertEqual($0 as? PushPayload.Failure, .notAnObject)
        }
    }
}

final class ImageInspectorTests: XCTestCase {
    private func png(width: UInt32, height: UInt32) -> Data {
        var bytes: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]
        for value in [width, height] {
            bytes += [UInt8(value >> 24 & 0xFF), UInt8(value >> 16 & 0xFF), UInt8(value >> 8 & 0xFF), UInt8(value & 0xFF)]
        }
        bytes += [8, 2, 0, 0, 0]
        return Data(bytes)
    }

    private func jpeg(width: UInt16, height: UInt16, padding: Int = 0) -> Data {
        var bytes: [UInt8] = [0xFF, 0xD8]
        // APP0 segment of length 16.
        bytes += [0xFF, 0xE0, 0x00, 0x10] + Array("JFIF".utf8) + [0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
        // Fill bytes before SOF0.
        bytes += [0xFF, 0xFF, 0xC0, 0x00, 0x11, 0x08,
                  UInt8(height >> 8), UInt8(height & 0xFF), UInt8(width >> 8), UInt8(width & 0xFF), 0x03]
        bytes += [UInt8](repeating: 0, count: 9 + padding)
        bytes += [0xFF, 0xD9]
        return Data(bytes)
    }

    func testReadsPNGAndJPEGDimensions() throws {
        let p = try ImageInspector.inspect(png(width: 800, height: 1000))
        XCTAssertEqual(p.format, .png)
        XCTAssertEqual(p.width, 800)
        XCTAssertEqual(p.height, 1000)
        let j = try ImageInspector.inspect(jpeg(width: 1280, height: 720))
        XCTAssertEqual(j.format, .jpeg)
        XCTAssertEqual(j.format.mimeType, "image/jpeg")
        XCTAssertEqual(j.width, 1280)
        XCTAssertEqual(j.height, 720)
    }

    func testUploadLimits() throws {
        XCTAssertNoThrow(try ImageInspector.validateForUpload(png(width: 200, height: 200)))
        XCTAssertThrowsError(try ImageInspector.validateForUpload(png(width: 199, height: 400))) {
            XCTAssertEqual($0 as? ImageInspector.Failure, .tooSmall(width: 199, height: 400))
        }
        XCTAssertThrowsError(try ImageInspector.validateForUpload(jpeg(width: 8000, height: 6000))) {
            XCTAssertEqual($0 as? ImageInspector.Failure, .tooManyPixels(width: 8000, height: 6000))
        }
        XCTAssertThrowsError(try ImageInspector.validateForUpload(jpeg(width: 1000, height: 1000, padding: ImageInspector.maxBytes))) {
            guard case .tooLarge = $0 as? ImageInspector.Failure else { return XCTFail("expected tooLarge") }
        }
        XCTAssertThrowsError(try ImageInspector.validateForUpload(Data("GIF89a....".utf8))) {
            XCTAssertEqual($0 as? ImageInspector.Failure, .unsupportedFormat)
        }
        XCTAssertThrowsError(try ImageInspector.validateForUpload(Data([0xFF, 0xD8, 0xFF, 0xD9]))) {
            XCTAssertEqual($0 as? ImageInspector.Failure, .unreadableDimensions)
        }
    }
}
