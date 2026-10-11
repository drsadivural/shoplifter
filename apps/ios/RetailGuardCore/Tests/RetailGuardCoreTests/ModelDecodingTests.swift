import Foundation
import XCTest
@testable import RetailGuardCore

final class ModelDecodingTests: XCTestCase {
    func testDecodesMe() throws {
        let me = try decode(Me.self, Fixtures.me)
        XCTAssertEqual(me.user.displayName, "Aiko Tanaka")
        XCTAssertEqual(me.user.role, .responder)
        XCTAssertEqual(me.user.theme, .system)
        XCTAssertTrue(me.user.mfaEnabled)
        XCTAssertEqual(me.org.timezone, "Asia/Tokyo")
        XCTAssertEqual(me.stores.map(\.name), ["Tokyo flagship"])
        XCTAssertTrue(me.can(.incidentRespond))
        XCTAssertFalse(me.can(.watchlistApprove))
        XCTAssertEqual(me.unreadNotifications, 3)
        XCTAssertEqual(me.session.expiresAt, date("2026-10-11T13:42:18Z"))
        let prefs = try XCTUnwrap(me.user.notificationPrefs)
        XCTAssertEqual(prefs.quietHours, QuietHours(start: "22:00", end: "07:00"))
        XCTAssertFalse(prefs.checkout)
        XCTAssertTrue(prefs.privatePreview)
        XCTAssertEqual(me.storeTime(for: Fixtures.storeId).timeZone.identifier, "Asia/Tokyo")
    }

    func testDecodesPagedIncidentSummaries() throws {
        let json = """
        {"items": [\(Fixtures.summary()), \(Fixtures.summary(status: "acknowledged", assignee: Fixtures.userId, version: 4))],
         "next_cursor": "eyJvIjo1MH0"}
        """
        let page = try decode(Paged<IncidentSummary>.self, json)
        XCTAssertEqual(page.items.count, 2)
        XCTAssertEqual(page.nextCursor, "eyJvIjo1MH0")
        let first = page.items[0]
        XCTAssertEqual(first.ref, "INC-2026-042")
        XCTAssertEqual(first.channel, .behaviorCandidate)
        XCTAssertEqual(first.status, .new)
        XCTAssertNil(first.assignee)
        XCTAssertEqual(first.evidenceState, .available)
        XCTAssertEqual(first.capturedAt, date("2026-10-11T01:42:18Z"))
        // Fractional seconds are accepted.
        XCTAssertEqual(first.ingestedAt!.timeIntervalSince1970, date("2026-10-11T01:42:20Z").timeIntervalSince1970 + 0.512, accuracy: 0.001)
        XCTAssertEqual(page.items[1].assignee?.id, Fixtures.userId)
        XCTAssertEqual(page.items[1].version, 4)
    }

    func testPagedAcceptsNullCursorAndBareArray() throws {
        let enveloped = try decode(Paged<TeamMember>.self, #"{"items": [{"id": "u1", "display_name": "Ken", "role": "store_admin", "on_duty": true}], "next_cursor": null}"#)
        XCTAssertNil(enveloped.nextCursor)
        XCTAssertEqual(enveloped.items.first?.role, .storeAdmin)
        let bare = try decode(Paged<TeamMember>.self, #"[{"id": "u2", "display_name": "Mei", "role": "responder", "on_duty": false}]"#)
        XCTAssertEqual(bare.items.map(\.displayName), ["Mei"])
    }

    func testDecodesFullIncident() throws {
        let incident = try decode(Incident.self, Fixtures.incident())
        XCTAssertEqual(incident.id, Fixtures.incidentId)
        XCTAssertEqual(incident.version, 3)
        XCTAssertEqual(incident.summary.priority, .high)
        XCTAssertTrue(incident.summary.delayed)
        XCTAssertEqual(incident.numericSignals.map(\.key), ["anomaly", "concealment_motion", "item_interaction", "visibility"])
        XCTAssertEqual(incident.numericSignals.first?.value ?? 0, 0.81, accuracy: 1e-9)
        XCTAssertEqual(incident.uncertainty, ["hand_occluded_2s"])
        XCTAssertEqual(incident.evidence.count, 2)
        XCTAssertTrue(incident.evidence[0].isVideo)
        XCTAssertEqual(incident.evidence[0].fileExtension, "mp4")
        XCTAssertFalse(incident.evidence[1].isVideo)
        // Author as object and as bare string.
        XCTAssertEqual(incident.notes[0].author?.id, Fixtures.userId)
        XCTAssertEqual(incident.notes[1].author?.displayName, "Store manager")
        XCTAssertNil(incident.notes[1].author?.id)
        XCTAssertEqual(incident.timeline.count, 3)
        XCTAssertNil(incident.timeline[0].actor)
        XCTAssertNil(incident.lossValue)
        XCTAssertEqual(incident.recoveredValue?.value, 0)
        XCTAssertEqual(incident.currency, "JPY")
        XCTAssertEqual(incident.cases.first?.ref, "CASE-2026-007")
    }

    func testIncidentRoundTripsThroughEncoder() throws {
        let incident = try decode(Incident.self, Fixtures.incident())
        let data = try RetailGuardJSON.makeEncoder().encode(incident)
        let again = try RetailGuardJSON.makeDecoder().decode(Incident.self, from: data)
        XCTAssertEqual(again.summary, incident.summary)
        XCTAssertEqual(again.evidence, incident.evidence)
        XCTAssertEqual(again.signals, incident.signals)
    }

    func testUnknownEnumValuesDecodeAsUnrecognized() throws {
        let json = Fixtures.summary(status: "archived").replacingOccurrences(of: "behavior_candidate", with: "drone_candidate")
        let summary = try decode(IncidentSummary.self, json)
        XCTAssertEqual(summary.status, .unrecognized)
        XCTAssertEqual(summary.channel, .unrecognized)
    }

    func testDecodesProfileDetailWithPhotos() throws {
        let json = """
        {"id": "prof-1", "kind": "watchlist", "reference": "WL-0007", "display_name": null,
         "basis": "Confirmed incident INC-2026-031 reviewed by LP manager", "source_incident_id": "inc-31",
         "store_ids": ["\(Fixtures.storeId)"], "status": "pending_review",
         "expires_at": "2027-04-10T14:59:59Z", "review_at": "2027-01-10",
         "role_context": null, "notice_recorded": null, "photo_count": 2, "approved_photo_count": 1,
         "gallery_state": "face_sdk_unavailable", "created_by": "\(Fixtures.otherUserId)", "approved_by": null,
         "version": 2, "created_at": "2026-10-01T03:00:00Z",
         "photos": [{"id": "ph-1", "profile_id": "prof-1", "profile_kind": "watchlist", "profile_reference": "WL-0007",
                     "media_id": "med-ph-1", "thumb_media_id": "med-ph-1t", "width": 800, "height": 1000,
                     "status": "approved",
                     "quality": {"image": {"sharpness": 182.4, "brightness": 121.0, "width": 800, "height": 1000},
                                 "face": {"status": "unavailable", "reason": "face_sdk_unavailable"}},
                     "provenance": "Store camera still, reviewed", "created_at": "2026-10-01T03:05:00Z"}],
         "linked_incidents": [{"id": "inc-31", "ref": "INC-2026-031", "outcome": "confirmed"}, "inc-35"],
         "history": [{"at": "2026-10-01T03:00:00Z", "action": "create", "actor": {"id": "\(Fixtures.otherUserId)", "display_name": "Ken"}}]}
        """
        let profile = try decode(Profile.self, json)
        XCTAssertEqual(profile.kind, .watchlist)
        XCTAssertEqual(profile.status, .pendingReview)
        XCTAssertEqual(profile.galleryState, .faceSDKUnavailable)
        XCTAssertEqual(profile.title, "WL-0007")
        XCTAssertEqual(profile.reviewAt, date("2027-01-10T00:00:00Z"))
        let photo = try XCTUnwrap(profile.photos?.first)
        XCTAssertEqual(photo.status, .approved)
        XCTAssertEqual(photo.quality?.image?.sharpness ?? 0, 182.4, accuracy: 1e-9)
        XCTAssertEqual(photo.quality?.face?.isAvailable, false)
        XCTAssertEqual(profile.linkedIncidents?.map(\.id), ["inc-31", "inc-35"])
        XCTAssertEqual(profile.history?.first?.actor?.displayName, "Ken")
        XCTAssertNil(profile.lastSeenAt)

        // Separation of duties: the creator may not approve; another approver may.
        let approver: Set<String> = ["watchlist.approve", "watchlist.manage"]
        XCTAssertEqual(profile.availableActions(userId: Fixtures.otherUserId, permissions: approver), [.delete])
        XCTAssertEqual(profile.availableActions(userId: Fixtures.userId, permissions: approver), [.approve, .reject, .delete])
        XCTAssertEqual(profile.availableActions(userId: Fixtures.userId, permissions: ["profile.read"]), [])
    }

    func testDecodesCameraWithBothChannelShapes() throws {
        let json = """
        {"id": "cam-01", "store_id": "\(Fixtures.storeId)", "edge_id": "edge-1", "name": "Entrance", "location": "Entrance",
         "address": "192.168.10.21", "vendor": "Axis", "model": "P3265", "stream_profile": "substream",
         "readiness": "ready", "analysis_state": "degraded",
         "channels": {"behavior": "running", "watchlist": {"state": "unavailable", "reason": "face_sdk_unavailable"},
                      "checkout": {"state": "not_requested"}},
         "readiness_report": {"checked_at": "2026-10-11T01:00:00Z", "codec": "h264", "width": 1280, "height": 720,
                              "fps": 15, "decoded_seconds": 10, "monotonic_time": true, "errors": []},
         "last_frame_at": "2026-10-11T01:41:58Z", "snapshot": {"media_id": "med-snap-1", "captured_at": "2026-10-11T01:41:00Z"},
         "activated_at": "2026-10-01T00:00:00Z", "has_credentials": true, "version": 7}
        """
        let camera = try decode(Camera.self, json)
        XCTAssertEqual(camera.readiness, .ready)
        XCTAssertEqual(camera.analysisState, .degraded)
        XCTAssertEqual(camera.channels["behavior"], ChannelStatus(state: .running, reason: nil))
        XCTAssertEqual(camera.channels["watchlist"], ChannelStatus(state: .unavailable, reason: "face_sdk_unavailable"))
        XCTAssertEqual(camera.channels["checkout"]?.state, .notRequested)
        XCTAssertEqual(camera.readinessReport?.width, 1280)
        XCTAssertEqual(camera.snapshot?.mediaId, "med-snap-1")
        XCTAssertFalse(camera.isFrameStale(now: date("2026-10-11T01:42:30Z")))
        XCTAssertTrue(camera.isFrameStale(now: date("2026-10-11T01:50:00Z")))
    }

    func testDecodesDashboardWithNullMedian() throws {
        let json = """
        {"open_alerts": 7, "reviewed_today": 14, "cameras": {"online": 18, "total": 20}, "median_ack_seconds": null,
         "awaiting_review": [\(Fixtures.summary())],
         "camera_health": [{"id": "cam-01", "name": "Entrance", "readiness": "ready", "analysis_state": "analyzing", "last_frame_at": null}],
         "trend": [{"date": "2026-10-10", "detections": 5, "reviewed": 4}],
         "last_refresh": "2026-10-11T01:42:30Z"}
        """
        let dashboard = try decode(Dashboard.self, json)
        XCTAssertEqual(dashboard.openAlerts, 7)
        XCTAssertNil(dashboard.medianAckSeconds, "null median must stay distinct from zero")
        XCTAssertEqual(dashboard.cameras.online, 18)
        XCTAssertEqual(dashboard.awaitingReview.count, 1)
        XCTAssertEqual(dashboard.cameraHealth.first?.analysisState, .analyzing)
        XCTAssertEqual(dashboard.trend.first?.id, "2026-10-10")
    }

    func testDecodesSearchCoverage() throws {
        let json = """
        {"items": [], "next_cursor": null,
         "coverage": {"from": "2026-10-01T15:00:00Z", "to": "2026-10-11T15:00:00Z", "retention_cutoff": "2026-09-11T00:00:00Z",
                      "cameras": [{"id": "cam-01", "name": "Entrance", "store_id": "\(Fixtures.storeId)", "activated_at": "2026-10-03T00:00:00Z",
                                   "outages": [{"from": "2026-10-05T01:00:00Z", "to": "2026-10-05T02:00:00Z"}]}],
                      "gaps": [{"camera_id": "cam-01", "from": "2026-10-01T15:00:00Z", "to": "2026-10-03T00:00:00Z", "reason": "before_activation"},
                               {"camera_id": null, "from": "2026-10-05T01:00:00Z", "to": "2026-10-05T02:00:00Z", "reason": "outage"}]}}
        """
        let response = try decode(SearchResponse.self, json)
        XCTAssertTrue(response.items.isEmpty)
        let coverage = try XCTUnwrap(response.coverage)
        XCTAssertEqual(coverage.cameras.first?.outages.count, 1)
        XCTAssertEqual(coverage.gaps.map(\.reason), [.beforeActivation, .outage])
        XCTAssertNil(coverage.gaps[1].cameraId)
    }

    func testDecodesVisitUnavailable() throws {
        let json = """
        {"available": false, "reason": "reid_unavailable",
         "events": [{"camera_id": "cam-01", "camera_name": "Entrance", "captured_at": "2026-10-11T01:42:18Z", "kind": "behavior_candidate"}]}
        """
        let visit = try decode(VisitTimeline.self, json)
        XCTAssertFalse(visit.available)
        XCTAssertEqual(visit.reason, "reid_unavailable")
        XCTAssertEqual(visit.events.first?.at, date("2026-10-11T01:42:18Z"))
    }

    func testNotificationPrefsEncodingAlwaysSendsPrivatePreview() throws {
        var prefs = NotificationPrefs(behavior: true, watchlist: false, checkout: true, rfid: false, sound: false,
                                      quietHours: nil, storeIds: [Fixtures.storeId])
        prefs.privatePreview = false
        let data = try RetailGuardJSON.makeEncoder().encode(PreferencesUpdate(notificationPrefs: prefs))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let encoded = try XCTUnwrap(object["notification_prefs"] as? [String: Any])
        XCTAssertEqual(encoded["private_preview"] as? Bool, true)
        XCTAssertTrue(encoded["quiet_hours"] is NSNull)
        XCTAssertNil(object["locale"], "unset fields are omitted from PATCH")
    }

    func testLoginResponseAndAuthConfig() throws {
        let login = try decode(LoginResponse.self, #"{"state": "mfa_required", "token": "tok_partial", "expires_at": "2026-10-11T02:00:00Z"}"#)
        XCTAssertEqual(login.state, .mfaRequired)
        XCTAssertEqual(login.token, "tok_partial")
        let config = try decode(AuthConfig.self, #"{"oidc_enabled": false, "password_login": true, "mfa_required_roles": ["org_admin","investigator"], "support_contact": null}"#)
        XCTAssertFalse(config.oidcEnabled)
        XCTAssertNil(config.supportContact)
    }

    func testDecodesWatchlistNameAndLastSeen() throws {
        let json = """
        {"id": "prof-2", "kind": "watchlist", "reference": "WL-0008", "display_name": "山田 太郎",
         "last_seen_at": "2026-10-10T09:45:00Z", "basis": "", "source_incident_id": null,
         "store_ids": ["\(Fixtures.storeId)"], "status": "draft", "expires_at": "2027-03-31T14:59:59Z",
         "photo_count": 0, "approved_photo_count": 0, "gallery_state": "not_in_gallery", "version": 1}
        """
        let profile = try decode(Profile.self, json)
        XCTAssertEqual(profile.title, "山田 太郎")
        XCTAssertEqual(profile.lastSeenAt, date("2026-10-10T09:45:00Z"))
        XCTAssertNil(profile.sourceIncidentId)
    }

    func testEncodesWatchlistCreateWithoutIncidentOrReason() throws {
        let encoder = RetailGuardJSON.makeEncoder()
        let full = CreateWatchlistProfile(reference: "WL-0009", displayName: "Suzuki", lastSeenAt: date("2026-10-10T09:45:00Z"),
                                          storeIds: ["s-1"], expiresAt: date("2027-03-31T14:59:59Z"))
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(full)) as? [String: Any])
        XCTAssertEqual(body["kind"] as? String, "watchlist")
        XCTAssertEqual(body["display_name"] as? String, "Suzuki")
        XCTAssertEqual(body["last_seen_at"] as? String, "2026-10-10T09:45:00Z")
        XCTAssertNil(body["source_incident_id"])
        XCTAssertNil(body["basis"])
        XCTAssertNil(body["review_at"])
        let minimal = CreateWatchlistProfile(reference: "WL-0010", displayName: nil, lastSeenAt: nil,
                                             storeIds: ["s-1"], expiresAt: date("2027-03-31T14:59:59Z"))
        let body2 = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(minimal)) as? [String: Any])
        XCTAssertNil(body2["display_name"])
        XCTAssertNil(body2["last_seen_at"])
    }
}
