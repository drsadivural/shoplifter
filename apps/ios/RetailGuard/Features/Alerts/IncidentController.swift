import Foundation
import Observation
import SwiftUI
import RetailGuardCore

/// Loads one incident and runs versioned commands against it. On 409 the
/// controller re-fetches and shows the current state; it never retries with
/// the new version on the user's behalf.
@MainActor
@Observable
final class IncidentController {
    struct Conflict: Equatable {
        let message: String
        let attemptedVersion: Int
        let currentVersion: Int?
    }

    let incidentId: String
    private(set) var state: Loadable<Incident> = .idle
    private(set) var conflict: Conflict?
    private(set) var successMessage: String?
    private(set) var isRefreshing = false

    init(incidentId: String) {
        self.incidentId = incidentId
    }

    var incident: Incident? { state.value }

    func load(_ appState: AppState, silently: Bool = false) async {
        if !silently, state.value == nil { state = .loading }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let incident = try await appState.api.incident(id: incidentId)
            state = .loaded(incident)
            if let conflict, let current = conflict.currentVersion, incident.version >= current {
                // The user has now seen the current state.
                self.conflict = Conflict(message: conflict.message, attemptedVersion: conflict.attemptedVersion,
                                         currentVersion: incident.version)
            }
        } catch {
            let failure = appState.present(error)
            if state.value == nil || failure.kind != .offline { state = .failed(failure) }
        }
    }

    /// Explicit refresh after a conflict: reload and clear the conflict banner.
    func refreshAfterConflict(_ appState: AppState) async {
        await load(appState, silently: true)
        conflict = nil
    }

    func context(_ appState: AppState) -> IncidentActionContext? {
        guard let incident, let userId = appState.userId else { return nil }
        return IncidentActionContext(summary: incident.summary, userId: userId, permissions: appState.permissions,
                                     knownLatestVersion: conflict?.currentVersion)
    }

    func allowed(_ appState: AppState) -> Set<IncidentAction> {
        guard let context = context(appState), conflict == nil else { return [] }
        return IncidentActions.allowed(context)
    }

    /// Runs a command with `expected_version` = the version on screen.
    /// Returns an error for the form to display, or nil on success.
    func perform(_ appState: AppState, success: String,
                 _ command: @escaping (APIClient, Int) async throws -> Incident) async -> UserFacingError? {
        guard let incident else {
            return UserFacingError(kind: .server, message: L("The incident is not loaded yet."), requestId: nil)
        }
        let expected = incident.version
        do {
            let updated = try await command(appState.api, expected)
            state = .loaded(updated)
            conflict = nil
            successMessage = success
            appState.requestInboxReload()
            return nil
        } catch {
            let failure = appState.present(error)
            if case .conflict(let current) = failure.kind {
                conflict = Conflict(message: failure.message, attemptedVersion: expected, currentVersion: current)
                // Show the current server state; the user decides what to do next.
                await load(appState, silently: true)
            }
            return failure
        }
    }

    func clearSuccess() { successMessage = nil }
}

/// Conflict banner: someone else changed the incident. Offers Refresh only.
struct ConflictBanner: View {
    @Environment(AppState.self) private var appState
    let controller: IncidentController

    var body: some View {
        if let conflict = controller.conflict {
            VStack(alignment: .leading, spacing: 8) {
                Label(L("Updated by someone else"), systemImage: "arrow.triangle.2.circlepath")
                    .font(.headline)
                    .foregroundStyle(Color.rgWarning)
                Text(conflict.message)
                    .font(.subheadline)
                    .foregroundStyle(Color.rgInk)
                Text(LF("Your action was based on version %@; the current version is %@. Nothing was overwritten.",
                        String(conflict.attemptedVersion), conflict.currentVersion.map(String.init) ?? "—"))
                    .font(.caption)
                    .foregroundStyle(Color.rgSecondaryText)
                Button {
                    Task { await controller.refreshAfterConflict(appState) }
                } label: {
                    HStack {
                        if controller.isRefreshing { ProgressView() }
                        Text(L("Refresh"))
                    }
                }
                .buttonStyle(.rgPrimary)
            }
            .rgCard()
            .accessibilityElement(children: .contain)
        }
    }
}
