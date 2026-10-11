import SwiftUI
import RetailGuardCore

enum IncidentSheet: Identifiable {
    case acknowledge, outcome(OutcomeDraft?), escalate, requestReview, reopen

    var id: String {
        switch self {
        case .acknowledge: return "acknowledge"
        case .outcome: return "outcome"
        case .escalate: return "escalate"
        case .requestReview: return "requestReview"
        case .reopen: return "reopen"
        }
    }
}

/// ios-09 — Review alert: evidence, camera, signals and the responder actions
/// permitted for the current status/assignee/version.
struct AlertDetailView: View {
    @Environment(AppState.self) private var appState
    @State private var controller: IncidentController
    @State private var sheet: IncidentSheet?
    @State private var playing: EvidenceItem?

    init(incidentId: String) {
        _controller = State(initialValue: IncidentController(incidentId: incidentId))
    }

    var body: some View {
        ScreenScaffold(title: L("Review alert"), subtitle: controller.incident?.summary.storeName) {
            ConflictBanner(controller: controller)
            LoadableView(state: controller.state, retry: { await controller.load(appState) }) { incident in
                content(incident)
            }
        }
        .refreshable { await controller.load(appState, silently: true) }
        .task { if case .idle = controller.state { await controller.load(appState) } }
        .sheet(item: $sheet) { sheet in
            IncidentSheetContent(sheet: sheet, controller: controller)
        }
        .fullScreenCover(item: $playing) { item in
            if let incident = controller.incident {
                EvidencePlayerView(incident: incident.summary, evidence: item)
            }
        }
    }

    @ViewBuilder
    private func content(_ incident: Incident) -> some View {
        if let message = controller.successMessage {
            InfoBanner(text: message, tone: .success, systemImage: "checkmark.circle")
                .onTapGesture { controller.clearSuccess() }
        }
        DraftNotice(incident: incident) { draft in sheet = .outcome(draft) }

        EvidenceCard(incident: incident) { item in playing = item }

        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: L("Timeline"))
            if incident.timeline.isEmpty {
                Text(L("No timeline entries yet.")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            }
            ForEach(Array(incident.timeline.enumerated()), id: \.offset) { _, entry in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "circle.inset.filled").font(.caption).foregroundStyle(Color.rgPrimary)
                        .accessibilityHidden(true)
                    Text(appState.format(entry.at, storeId: incident.summary.storeId, style: .timeWithSeconds))
                        .font(.subheadline.monospacedDigit())
                    Text(verbatim: "·").accessibilityHidden(true)
                    Text(TimelineActionName.title(entry.action)).font(.subheadline)
                    if let actor = entry.actor?.displayName, !actor.isEmpty {
                        Text(actor).font(.caption).foregroundStyle(Color.rgSecondaryText)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .rgCard()

        SignalsCard(incident: incident)

        VStack(alignment: .leading, spacing: 12) {
            KeyValueRow(label: L("Assignee"), value: assigneeText(incident))
            KeyValueRow(label: L("Status"), value: incident.status.presentation.text)
            if let deadline = incident.ackDeadline, incident.status == .new {
                KeyValueRow(label: L("Acknowledgement deadline"),
                            value: appState.format(deadline, storeId: incident.summary.storeId, style: .timeWithSeconds),
                            valueTone: deadline < Date() ? .critical : nil)
            }
            IncidentActionBar(incident: incident, controller: controller, sheet: $sheet)
            Text(LF("Version %@ · synchronized across devices", String(incident.version)))
                .font(.caption)
                .foregroundStyle(Color.rgSecondaryText)
            Button {
                appState.open(.incident(incident.id))
            } label: {
                Label(L("Incident details"), systemImage: "doc.text.magnifyingglass")
            }
            .buttonStyle(.rgSecondaryWide)
        }
        .rgCard()
    }

    private func assigneeText(_ incident: Incident) -> String {
        guard let assignee = incident.summary.assignee else { return L("Unassigned") }
        return assignee.id == appState.userId ? L("You") : assignee.displayName
    }
}

/// Evidence clip/frame preview with explicit pending/unavailable/expired states.
struct EvidenceCard: View {
    @Environment(AppState.self) private var appState
    let incident: Incident
    let onPlay: (EvidenceItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SectionTitle(text: L("Evidence clip"))
                Spacer()
                if incident.status != .resolved {
                    StatusBadge(text: L("Review required"), systemImage: "exclamationmark.circle", tone: .warning)
                }
            }
            switch incident.summary.evidenceState {
            case .available:
                let clip = incident.evidence.first(where: \.isVideo)
                let frame = incident.evidence.first(where: { !$0.isVideo })
                ZStack(alignment: .bottomLeading) {
                    AuthenticatedImage(mediaId: frame?.mediaId, thumbnail: false, contentMode: .fill,
                                       imageLabel: L("Evidence frame"))
                        .frame(height: 200)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    Text(appState.format(incident.summary.capturedAt, storeId: incident.summary.storeId,
                                         style: .evidence, includeZone: true))
                        .font(.caption.monospacedDigit())
                        .padding(6)
                        .foregroundStyle(.white)
                        .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 6))
                        .padding(8)
                    if let clip {
                        Button {
                            onPlay(clip)
                        } label: {
                            Image(systemName: "play.circle.fill")
                                .font(.system(.largeTitle))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, Color.rgPrimary)
                                .rgTapTarget()
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityLabel(L("Play evidence clip"))
                    }
                }
                .frame(height: 200)
                if let clip {
                    Button {
                        onPlay(clip)
                    } label: {
                        Label(L("Open evidence player"), systemImage: "film")
                    }
                    .buttonStyle(.rgSecondaryWide)
                } else if incident.evidence.isEmpty {
                    Text(L("No evidence files are attached.")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
                }
            case .pending:
                InfoBanner(text: L("Evidence is still uploading from the store appliance. Refresh in a moment."),
                           tone: .info, systemImage: "hourglass")
            case .unavailable:
                InfoBanner(text: L("No evidence was captured for this event (camera outage or capture failure)."),
                           tone: .warning, systemImage: "film.stack")
            case .expired:
                InfoBanner(text: L("Evidence has expired under the retention policy and is no longer available."),
                           tone: .neutral, systemImage: "clock.badge.xmark")
            case .unrecognized:
                InfoBanner(text: L("Evidence state is not recognized by this app version."), tone: .neutral,
                           systemImage: "questionmark.circle")
            }
            HumanReviewNotice()
        }
        .rgCard()
    }
}

/// Camera + raw model signals. Values are model scores, not probabilities.
struct SignalsCard: View {
    let incident: Incident

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: L("Camera"))
            KeyValueRow(label: L("Camera"), value: incident.summary.cameraName ?? L("Not available"))
            KeyValueRow(label: L("Type"), value: incident.summary.channel.title)
            Divider()
            Text(L("Signal")).font(.headline)
            if incident.numericSignals.isEmpty {
                Text(L("No model signals were reported for this event.")).font(.subheadline)
                    .foregroundStyle(Color.rgSecondaryText)
            }
            ForEach(incident.numericSignals, id: \.key) { signal in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(SignalName.title(signal.key)).font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(signal.value.formatted(.number.precision(.fractionLength(2))))
                            .font(.subheadline.monospacedDigit())
                    }
                    if (0...1).contains(signal.value) {
                        ProgressView(value: signal.value)
                            .tint(Color.rgAccent)
                            .accessibilityHidden(true)
                    }
                    Text(L("Candidate evidence · human review required"))
                        .font(.caption)
                        .foregroundStyle(Color.rgSecondaryText)
                }
                .padding(12)
                .background(Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityElement(children: .combine)
            }
            FieldHint(text: L("Signals are raw model scores used to gate alerts. They are not probabilities of wrongdoing."))
            if let gate = incident.gateReason {
                KeyValueRow(label: L("Trigger signals"), value: gate.replacingOccurrences(of: "_", with: " "))
            }
            if !incident.uncertainty.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("Reported uncertainty")).font(.subheadline.weight(.semibold))
                    ForEach(incident.uncertainty, id: \.self) { item in
                        Label(item.replacingOccurrences(of: "_", with: " "), systemImage: "questionmark.diamond")
                            .font(.subheadline)
                    }
                }
            }
            if let model = incident.modelVersion {
                KeyValueRow(label: L("Model"), value: model)
            }
        }
        .rgCard()
    }
}

/// Buttons for the actions the state machine allows. Actions that are not
/// allowed are explained instead of shown disabled.
struct IncidentActionBar: View {
    @Environment(AppState.self) private var appState
    let incident: Incident
    let controller: IncidentController
    @Binding var sheet: IncidentSheet?

    var body: some View {
        let allowed = controller.allowed(appState)
        VStack(alignment: .leading, spacing: 8) {
            if allowed.contains(.claim) {
                Button(L("Acknowledge")) { sheet = .acknowledge }
                    .buttonStyle(.rgPrimaryWide)
            }
            if allowed.contains(.recordOutcome) {
                Button(L("Review outcome")) { sheet = .outcome(nil) }
                    .buttonStyle(.rgPrimaryWide)
            }
            if allowed.contains(.requestReview) {
                Button(L("Request review")) { sheet = .requestReview }
                    .buttonStyle(.rgSecondaryWide)
            }
            if allowed.contains(.escalate) {
                Button(L("Request assistance")) { sheet = .escalate }
                    .buttonStyle(.rgSecondaryWide)
            }
            if allowed.contains(.reopen) {
                Button(L("Reopen")) { sheet = .reopen }
                    .buttonStyle(.rgSecondaryWide)
            }
            if let explanation = explanation(allowed) {
                FieldHint(text: explanation)
            }
        }
    }

    private func explanation(_ allowed: Set<IncidentAction>) -> String? {
        if controller.conflict != nil { return L("Refresh to see the current state before taking action.") }
        guard let context = controller.context(appState) else { return nil }
        if !allowed.isEmpty && allowed != [.addNote] { return nil }
        switch IncidentActions.denial(for: .recordOutcome, context) {
        case .ownedByAnother(let person)?:
            return LF("%@ owns this incident. You can add notes; only the owner can record the outcome.", person.displayName)
        case .resolved?:
            return L("This incident is resolved.")
        case .missingPermission?:
            return L("Your role can view this incident but not respond to it.")
        case .staleVersion?:
            return L("Refresh to see the current state before taking action.")
        default:
            return nil
        }
    }
}

/// Shows a locally saved outcome draft for this incident.
struct DraftNotice: View {
    @Environment(AppState.self) private var appState
    let incident: Incident
    let onOpen: (OutcomeDraft) -> Void

    var body: some View {
        if let userId = appState.userId, let draft = appState.drafts.draft(incidentId: incident.id, userId: userId) {
            VStack(alignment: .leading, spacing: 8) {
                Label(L("Pending draft"), systemImage: "doc.badge.clock").font(.headline)
                Text(LF("Saved %@ against version %@.", appState.format(draft.updatedAt, storeId: incident.summary.storeId, style: .timeWithSeconds), String(draft.baseVersion)))
                    .font(.subheadline)
                if draft.baseVersion != incident.version {
                    InfoBanner(text: LF("The incident changed since this draft (now version %@). Review the current state before using the draft.", String(incident.version)),
                               tone: .warning)
                } else {
                    FieldHint(text: L("Refresh before submission: the draft is checked against the latest incident when you submit."))
                }
                Button(L("Open draft")) { onOpen(draft) }
                    .buttonStyle(.rgSecondary)
            }
            .rgCard()
        }
    }
}

/// Presents ios-11 / ios-12 / ios-13 and reason sheets.
struct IncidentSheetContent: View {
    @Environment(AppState.self) private var appState
    let sheet: IncidentSheet
    let controller: IncidentController

    var body: some View {
        switch sheet {
        case .acknowledge:
            AcknowledgeView(controller: controller)
        case .outcome(let draft):
            OutcomeView(controller: controller, draft: draft)
        case .escalate:
            EscalateView(controller: controller)
        case .requestReview:
            ReasonSheet(title: L("Request review"),
                        message: L("Ask an investigator or store manager to review this alert. The incident stays assigned to you."),
                        confirmTitle: L("Request review")) { reason in
                await controller.perform(appState, success: L("Review requested.")) { api, version in
                    try await api.requestReview(incidentId: controller.incidentId, expectedVersion: version, reason: reason)
                }
            }
        case .reopen:
            ReasonSheet(title: L("Reopen"),
                        message: L("Reopening returns the incident to review. The previous outcome stays in the history."),
                        confirmTitle: L("Reopen")) { reason in
                await controller.perform(appState, success: L("Incident reopened.")) { api, version in
                    try await api.reopen(incidentId: controller.incidentId, expectedVersion: version, reason: reason)
                }
            }
        }
    }
}
