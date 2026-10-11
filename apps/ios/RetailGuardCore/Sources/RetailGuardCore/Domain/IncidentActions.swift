import Foundation

/// Responder commands on an incident.
public enum IncidentAction: String, CaseIterable, Sendable, Hashable {
    case claim
    case requestReview
    case recordOutcome
    case escalate
    case reopen
    case addNote
}

/// Who currently owns the incident from the viewer's point of view.
public enum Ownership: Equatable, Sendable {
    case unassigned
    case mine
    case other(PersonRef)
}

/// Why an action is not offered. Used to explain state instead of showing a
/// disabled control.
public enum ActionDenial: Equatable, Sendable {
    case missingPermission(String)
    case resolved
    case notResolved
    case ownedByAnother(PersonRef)
    case alreadyOwned
    case claimRequired
    case staleVersion(local: Int, latest: Int)
    case notAvailableInStatus(IncidentStatus)
    case unrecognizedStatus
}

/// Incident state machine helpers mirroring the server rules in docs/API_V1.md:
///
/// - `claim`: `new`/unassigned → `acknowledged`, assignee = actor. Someone else
///   owning it → 409 `owned_by_another_responder`.
/// - `request-review`: assignee only, `acknowledged` → `reviewing`.
/// - `outcome`: assignee only (claim first), `acknowledged|reviewing` → `resolved`;
///   `confirmed` is rejected while evidence is pending.
/// - `escalate`: unresolved incidents not owned by someone else.
/// - `reopen`: resolved incidents, `incident.reopen` permission.
///
/// The server remains the authority; these helpers only decide which controls
/// to offer. All transitions send `expected_version`.
public struct IncidentActionContext: Sendable, Equatable {
    public let status: IncidentStatus
    public let assignee: PersonRef?
    public let evidenceState: EvidenceState
    public let version: Int
    public let userId: String
    public let permissions: Set<String>
    /// A newer version learned elsewhere (409 `current_version`, list refresh).
    public let knownLatestVersion: Int?

    public init(status: IncidentStatus, assignee: PersonRef?, evidenceState: EvidenceState, version: Int,
                userId: String, permissions: Set<String>, knownLatestVersion: Int? = nil) {
        self.status = status
        self.assignee = assignee
        self.evidenceState = evidenceState
        self.version = version
        self.userId = userId
        self.permissions = permissions
        self.knownLatestVersion = knownLatestVersion
    }

    public init(summary: IncidentSummary, userId: String, permissions: Set<String>, knownLatestVersion: Int? = nil) {
        self.init(status: summary.status, assignee: summary.assignee, evidenceState: summary.evidenceState,
                  version: summary.version, userId: userId, permissions: permissions,
                  knownLatestVersion: knownLatestVersion)
    }

    public var ownership: Ownership {
        guard let assignee else { return .unassigned }
        if assignee.id == userId { return .mine }
        return .other(assignee)
    }

    public var isStale: Bool {
        guard let latest = knownLatestVersion else { return false }
        return latest > version
    }
}

public enum IncidentActions {
    public static func allowed(_ context: IncidentActionContext) -> Set<IncidentAction> {
        Set(IncidentAction.allCases.filter { denial(for: $0, context) == nil })
    }

    /// `nil` when the action is allowed.
    public static func denial(for action: IncidentAction, _ context: IncidentActionContext) -> ActionDenial? {
        let respond = Permission.incidentRespond.rawValue
        if context.status == .unrecognized { return .unrecognizedStatus }
        if context.isStale, action != .addNote {
            return .staleVersion(local: context.version, latest: context.knownLatestVersion ?? context.version)
        }
        switch action {
        case .claim:
            guard context.permissions.contains(respond) else { return .missingPermission(respond) }
            if context.status == .resolved { return .resolved }
            switch context.ownership {
            case .unassigned: return nil
            case .mine: return .alreadyOwned
            case .other(let person): return .ownedByAnother(person)
            }
        case .requestReview:
            guard context.permissions.contains(respond) else { return .missingPermission(respond) }
            if context.status == .resolved { return .resolved }
            switch context.ownership {
            case .unassigned: return .claimRequired
            case .other(let person): return .ownedByAnother(person)
            case .mine: return context.status == .acknowledged ? nil : .notAvailableInStatus(context.status)
            }
        case .recordOutcome:
            guard context.permissions.contains(respond) else { return .missingPermission(respond) }
            if context.status == .resolved { return .resolved }
            switch context.ownership {
            case .unassigned: return .claimRequired
            case .other(let person): return .ownedByAnother(person)
            case .mine:
                return (context.status == .acknowledged || context.status == .reviewing) ? nil : .notAvailableInStatus(context.status)
            }
        case .escalate:
            guard context.permissions.contains(respond) else { return .missingPermission(respond) }
            if context.status == .resolved { return .resolved }
            if case .other(let person) = context.ownership { return .ownedByAnother(person) }
            return nil
        case .reopen:
            let reopen = Permission.incidentReopen.rawValue
            guard context.permissions.contains(reopen) else { return .missingPermission(reopen) }
            return context.status == .resolved ? nil : .notResolved
        case .addNote:
            guard context.permissions.contains(respond) else { return .missingPermission(respond) }
            return nil
        }
    }

    /// Outcomes a reviewer may currently select. `confirmed` requires evidence
    /// that is not pending (server: 409 `evidence_pending`).
    public static func selectableOutcomes(evidenceState: EvidenceState) -> [Outcome] {
        evidenceState == .pending ? [.falseAlert, .inconclusive] : Outcome.selectable
    }
}

// MARK: - Form validation

public enum OutcomeFieldError: String, Equatable, Sendable {
    case outcomeRequired = "outcome_required"
    case reasonRequired = "reason_required"
    case reasonTooLong = "reason_too_long"
    case invalidAmount = "invalid_amount"
    case evidencePending = "evidence_pending"
}

public struct OutcomeForm: Sendable, Equatable, Codable {
    public var outcome: Outcome?
    public var reason: String
    public var observedBehavior: String
    /// Raw user input in the locale-independent form `1234.50` (empty = none).
    public var lossValue: String
    public var recoveredValue: String

    public init(outcome: Outcome? = nil, reason: String = "", observedBehavior: String = "",
                lossValue: String = "", recoveredValue: String = "") {
        self.outcome = outcome
        self.reason = reason
        self.observedBehavior = observedBehavior
        self.lossValue = lossValue
        self.recoveredValue = recoveredValue
    }

    public static let maxReasonLength = 2000

    /// Field → error. Empty means valid.
    public func validate(evidenceState: EvidenceState) -> [String: OutcomeFieldError] {
        var errors: [String: OutcomeFieldError] = [:]
        if outcome == nil || outcome == .unrecognized { errors["outcome"] = .outcomeRequired }
        if outcome == .confirmed && evidenceState == .pending { errors["outcome"] = .evidencePending }
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { errors["reason"] = .reasonRequired }
        if trimmed.count > Self.maxReasonLength { errors["reason"] = .reasonTooLong }
        if !lossValue.isEmpty && Self.parseAmount(lossValue) == nil { errors["loss_value"] = .invalidAmount }
        if !recoveredValue.isEmpty && Self.parseAmount(recoveredValue) == nil { errors["recovered_value"] = .invalidAmount }
        return errors
    }

    public func command(expectedVersion: Int) -> OutcomeCommand? {
        guard let outcome, outcome != .unrecognized else { return nil }
        let observed = observedBehavior.trimmingCharacters(in: .whitespacesAndNewlines)
        return OutcomeCommand(expectedVersion: expectedVersion, outcome: outcome,
                              reason: reason.trimmingCharacters(in: .whitespacesAndNewlines),
                              observedBehavior: observed.isEmpty ? nil : observed,
                              lossValue: Self.parseAmount(lossValue),
                              recoveredValue: Self.parseAmount(recoveredValue))
    }

    /// Non-negative decimal with at most 2 fraction digits. `,` is a grouping
    /// separator (`1,980` = 1980) unless it is the only separator and is
    /// followed by 1–2 trailing digits (`12,5` = 12.5).
    public static func parseAmount(_ raw: String) -> Decimal? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "_", with: "")
        if text.isEmpty { return nil }
        if !text.contains("."), text.filter({ $0 == "," }).count == 1,
           let comma = text.firstIndex(of: ","), (1...2).contains(text.distance(from: comma, to: text.endIndex) - 1) {
            text = text.replacingOccurrences(of: ",", with: ".")
        } else {
            text = text.replacingOccurrences(of: ",", with: "")
        }
        let allowed = CharacterSet(charactersIn: "0123456789.")
        guard text.unicodeScalars.allSatisfy({ allowed.contains($0) }),
              text.filter({ $0 == "." }).count <= 1 else { return nil }
        if let dot = text.firstIndex(of: ".") {
            let fraction = text[text.index(after: dot)...]
            if fraction.count > 2 { return nil }
        }
        guard let value = Decimal(string: text, locale: Locale(identifier: "en_US_POSIX")), value >= 0 else { return nil }
        return value
    }
}
