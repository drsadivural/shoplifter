import Foundation

public enum DraftSubmissionError: Error, Equatable, Sendable {
    /// The incident changed since the draft was written. Nothing was sent;
    /// the draft is kept. Show `current` and let the responder decide.
    case conflict(current: Incident)
    /// The current incident no longer permits recording an outcome (resolved,
    /// owned by someone else, permission removed). Nothing was sent.
    case notAllowed(current: Incident, reason: ActionDenial)
    /// Local validation failed; nothing was sent.
    case invalid([String: OutcomeFieldError])
    /// Any other API failure (offline, session expired, …). Draft is kept.
    case api(APIError)
    /// The draft no longer exists (expired or removed).
    case draftMissing
}

/// Submits an offline outcome draft safely:
///
/// 1. validate locally;
/// 2. **GET the current incident** (refresh before submit);
/// 3. abort with `.conflict` if `version != draft.baseVersion` (never rebase);
/// 4. check the state machine still allows `recordOutcome` for this user;
/// 5. POST the outcome with `expected_version = draft.baseVersion`;
///    a server 409 is reported as `.conflict` with the re-fetched incident;
/// 6. remove the draft only after success.
public struct DraftSubmitter: Sendable {
    public let service: IncidentCommandService
    public let store: DraftStore
    public let userId: String
    public let permissions: Set<String>

    public init(service: IncidentCommandService, store: DraftStore, userId: String, permissions: Set<String>) {
        self.service = service
        self.store = store
        self.userId = userId
        self.permissions = permissions
    }

    /// Refresh only: fetches the incident and records whether the draft is
    /// still based on the current version.
    public func refresh(draftId: UUID) async throws -> (draft: OutcomeDraft, current: Incident) {
        guard let draft = store.draft(id: draftId), draft.userId == userId else {
            throw DraftSubmissionError.draftMissing
        }
        let current: Incident
        do {
            current = try await service.incident(id: draft.incidentId)
        } catch let error as APIError {
            throw DraftSubmissionError.api(error)
        }
        let updated = (try? store.recordRefresh(draftId: draftId, currentVersion: current.version)) ?? draft
        return (updated, current)
    }

    public func submit(draftId: UUID) async throws -> Incident {
        guard let draft = store.draft(id: draftId), draft.userId == userId else {
            throw DraftSubmissionError.draftMissing
        }

        // 1. Refresh before submit.
        let current: Incident
        do {
            current = try await service.incident(id: draft.incidentId)
        } catch let error as APIError {
            throw DraftSubmissionError.api(error)
        }

        // 2. Version check — abort, keep the draft, surface current state.
        if current.version != draft.baseVersion {
            _ = try? store.recordRefresh(draftId: draftId, currentVersion: current.version)
            throw DraftSubmissionError.conflict(current: current)
        }

        // 3. Validate against the *current* evidence state.
        let errors = draft.form.validate(evidenceState: current.summary.evidenceState)
        if !errors.isEmpty { throw DraftSubmissionError.invalid(errors) }

        // 4. State machine / permission check against the current incident.
        let context = IncidentActionContext(summary: current.summary, userId: userId, permissions: permissions)
        if let denial = IncidentActions.denial(for: .recordOutcome, context) {
            throw DraftSubmissionError.notAllowed(current: current, reason: denial)
        }

        guard let command = draft.form.command(expectedVersion: draft.baseVersion) else {
            throw DraftSubmissionError.invalid(["outcome": .outcomeRequired])
        }

        // 5. Submit with the draft's base version.
        do {
            let result = try await service.recordOutcome(incidentId: draft.incidentId, command: command)
            try? store.remove(id: draftId)
            return result
        } catch let error as APIError {
            if error.isConflict {
                if let latest = try? await service.incident(id: draft.incidentId) {
                    _ = try? store.recordRefresh(draftId: draftId, currentVersion: latest.version)
                    throw DraftSubmissionError.conflict(current: latest)
                }
            }
            throw DraftSubmissionError.api(error)
        }
    }
}
