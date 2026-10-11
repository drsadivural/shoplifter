import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import RetailGuardCore

/// Injected transport stub: routes by "METHOD path" and records every request.
final class StubTransport: HTTPTransport, @unchecked Sendable {
    struct Response {
        let status: Int
        let body: Data
        let headers: [String: String]
    }

    private let lock = NSLock()
    private var routes: [String: [Response]] = [:]
    private var errors: [String: Error] = [:]
    private(set) var requests: [URLRequest] = []

    func on(_ method: String, _ path: String, status: Int = 200, json: String, headers: [String: String] = [:]) {
        lock.lock(); defer { lock.unlock() }
        routes["\(method) \(path)", default: []].append(Response(status: status, body: Data(json.utf8), headers: headers))
    }

    func fail(_ method: String, _ path: String, with error: Error) {
        lock.lock(); defer { lock.unlock() }
        errors["\(method) \(path)"] = error
    }

    var recorded: [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return requests
    }

    func requests(matching method: String, _ path: String) -> [URLRequest] {
        recorded.filter { $0.httpMethod == method && $0.url?.path == path }
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let key = "\(request.httpMethod ?? "GET") \(request.url?.path ?? "")"
        let (response, error): (Response?, Error?) = {
            lock.lock(); defer { lock.unlock() }
            requests.append(request)
            if let error = errors[key] { return (nil, error) }
            guard var queue = routes[key], !queue.isEmpty else { return (nil, nil) }
            let first = queue.removeFirst()
            // Keep the last response for repeated calls.
            routes[key] = queue.isEmpty ? [first] : queue
            return (first, nil)
        }()
        if let error { throw error }
        guard let response else {
            let body = Data(#"{"code":"not_found","message":"no stub","request_id":"stub","retriable":false}"#.utf8)
            return (body, HTTPURLResponse(url: request.url!, statusCode: 404, httpVersion: "HTTP/1.1",
                                          headerFields: ["Content-Type": "application/json"])!)
        }
        var headers = response.headers
        headers["Content-Type"] = headers["Content-Type"] ?? "application/json"
        headers["X-Request-ID"] = headers["X-Request-ID"] ?? "srv-req-1"
        return (response.body, HTTPURLResponse(url: request.url!, statusCode: response.status,
                                               httpVersion: "HTTP/1.1", headerFields: headers)!)
    }
}

func makeClient(_ transport: StubTransport, token: String? = "tok_live_123") -> APIClient {
    let counter = LockedValue(0)
    let client = APIClient(baseURL: URL(string: "https://shoplifter.ayonix.com")!, transport: transport,
                           userAgent: "RetailGuard-iOS/test", requestIdFactory: {
                               counter.mutate { value -> String in
                                   value += 1
                                   return "req-\(value)"
                               }
                           })
    client.setToken(token)
    return client
}

func bodyJSON(_ request: URLRequest) -> [String: Any] {
    guard let data = request.httpBody,
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return object
}

func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try RetailGuardJSON.makeDecoder().decode(T.self, from: Data(json.utf8))
}

func date(_ string: String) -> Date {
    RFC3339.parse(string)!
}

enum Fixtures {
    static let userId = "6f1c1e8a-2f5b-4c0e-9d0a-1b2c3d4e5f60"
    static let otherUserId = "a1b2c3d4-0000-4000-8000-000000000002"
    static let storeId = "2d9c5b5e-7f43-4b8a-9d2a-55b1f0c0a001"
    static let incidentId = "c0ffee00-1111-4222-8333-444455556666"

    static let me = """
    {
      "user": {"id": "\(userId)", "email": "responder@retail.example", "display_name": "Aiko Tanaka",
               "role": "responder", "locale": "ja", "theme": "system", "mfa_enabled": true,
               "notification_prefs": {"behavior": true, "watchlist": true, "checkout": false, "rfid": false,
                                      "sound": true, "private_preview": true,
                                      "quiet_hours": {"start": "22:00", "end": "07:00"},
                                      "store_ids": ["\(storeId)"]}},
      "org": {"id": "0e0e0e0e-0000-4000-8000-000000000001", "name": "Ayonix Retail", "timezone": "Asia/Tokyo", "region": "ap-northeast-1"},
      "stores": [{"id": "\(storeId)", "name": "Tokyo flagship", "timezone": "Asia/Tokyo", "region": "Kanto"}],
      "permissions": ["dashboard.read", "incident.read", "incident.respond", "search.metadata", "camera.read", "profile.read"],
      "session": {"id": "sess-1", "expires_at": "2026-10-11T13:42:18Z", "mfa_verified": true},
      "unread_notifications": 3
    }
    """

    static func summary(status: String = "new", assignee: String? = nil, version: Int = 3,
                        evidence: String = "available", outcome: String? = nil) -> String {
        let assigneeJSON = assignee.map { #"{"id": "\#($0)", "display_name": "Responder \#($0.prefix(4))"}"# } ?? "null"
        let outcomeJSON = outcome.map { "\"\($0)\"" } ?? "null"
        return """
        {"id": "\(incidentId)", "ref": "INC-2026-042", "store_id": "\(storeId)", "store_name": "Tokyo flagship",
         "camera_id": "cam-01", "camera_name": "Cosmetics aisle", "channel": "behavior_candidate",
         "status": "\(status)", "outcome": \(outcomeJSON), "priority": "normal", "assignee": \(assigneeJSON),
         "evidence_state": "\(evidence)", "captured_at": "2026-10-11T01:42:18Z",
         "ingested_at": "2026-10-11T01:42:20.512Z", "delayed": false, "version": \(version)}
        """
    }

    static func incident(status: String = "acknowledged", assignee: String? = userId, version: Int = 3,
                         evidence: String = "available") -> String {
        let assigneeJSON = assignee.map { #"{"id": "\#($0)", "display_name": "Aiko Tanaka"}"# } ?? "null"
        return """
        {"id": "\(incidentId)", "ref": "INC-2026-042", "store_id": "\(storeId)", "store_name": "Tokyo flagship",
         "camera_id": "cam-01", "camera_name": "Cosmetics aisle", "channel": "behavior_candidate",
         "status": "\(status)", "outcome": null, "priority": "high", "assignee": \(assigneeJSON),
         "evidence_state": "\(evidence)", "captured_at": "2026-10-11T01:42:18Z",
         "ingested_at": "2026-10-11T01:42:21Z", "delayed": true, "version": \(version),
         "description": "Candidate concealment near shelf zone",
         "signals": {"anomaly": 0.81, "item_interaction": 0.66, "concealment_motion": 0.72, "visibility": 0.9},
         "gate_reason": "item_interaction+concealment_motion",
         "model_version": "behavior-shadow-0.3.1",
         "uncertainty": ["hand_occluded_2s"],
         "evidence": [{"media_id": "med-clip-1", "mime": "video/mp4", "sha256": "\(String(repeating: "a", count: 64))", "kind": "clip"},
                      {"media_id": "med-frame-1", "mime": "image/jpeg", "sha256": "\(String(repeating: "b", count: 64))", "kind": "frame"}],
         "notes": [{"id": "note-1", "author": {"id": "\(userId)", "display_name": "Aiko Tanaka"}, "body": "Checked aisle", "created_at": "2026-10-11T01:45:00Z"},
                   {"id": "note-2", "author": "Store manager", "body": "Noted", "created_at": "2026-10-11T01:46:00Z"}],
         "reviews": [{"id": "rev-1", "actor": {"id": "\(userId)", "display_name": "Aiko Tanaka"}, "action": "claim", "outcome": null, "reason": null, "created_at": "2026-10-11T01:43:00Z"}],
         "timeline": [{"at": "2026-10-11T01:42:10Z", "action": "entry", "actor": null},
                      {"at": "2026-10-11T01:42:18Z", "action": "trigger", "actor": null},
                      {"at": "2026-10-11T01:43:00Z", "action": "claim", "actor": {"id": "\(userId)", "display_name": "Aiko Tanaka"}}],
         "observed_behavior": null, "loss_value": null, "recovered_value": "0", "currency": "JPY",
         "ack_deadline": "2026-10-11T01:47:18Z", "acknowledged_at": "2026-10-11T01:43:00Z", "resolved_at": null,
         "cases": [{"id": "case-1", "ref": "CASE-2026-007"}]}
        """
    }
}
