import SwiftUI
import RetailGuardCore

/// ios-14 — Incident details: evidence, outcome, notes, history, related visits.
struct IncidentDetailView: View {
    @Environment(AppState.self) private var appState
    @State private var controller: IncidentController
    @State private var sheet: IncidentSheet?
    @State private var playing: EvidenceItem?
    @State private var noteText = ""
    @State private var noteBusy = false
    @State private var noteError: UserFacingError?

    init(incidentId: String) {
        _controller = State(initialValue: IncidentController(incidentId: incidentId))
    }

    var body: some View {
        ScreenScaffold(title: L("Incident details"), subtitle: controller.incident.map { "\($0.summary.ref) · \($0.summary.storeName ?? "")" }) {
            ConflictBanner(controller: controller)
            LoadableView(state: controller.state, retry: { await controller.load(appState) }) { incident in
                content(incident)
            }
        }
        .refreshable { await controller.load(appState, silently: true) }
        .task { if case .idle = controller.state { await controller.load(appState) } }
        .sheet(item: $sheet) { IncidentSheetContent(sheet: $0, controller: controller) }
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
        }
        // Summary
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                incident.status.presentation.badge
                incident.summary.evidenceState.presentation.badge
                if let priority = incident.summary.priority { priority.presentation.badge }
            }
            KeyValueRow(label: L("Type"), value: incident.summary.channel.title)
            KeyValueRow(label: L("Captured"), value: appState.format(incident.summary.capturedAt, storeId: incident.summary.storeId,
                                                                      style: .dateTime, includeZone: true))
            if let ingested = incident.summary.ingestedAt {
                KeyValueRow(label: L("Received"), value: appState.format(ingested, storeId: incident.summary.storeId, style: .dateTime))
            }
            if incident.summary.delayed {
                InfoBanner(text: L("This event reached the server late (store appliance was offline or queued)."), tone: .warning,
                           systemImage: "clock.arrow.circlepath")
            }
            if let description = incident.description, !description.isEmpty {
                Text(description).font(.body)
            }
        }
        .rgCard()

        // Evidence
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Evidence"))
            if incident.evidence.isEmpty || incident.summary.evidenceState != .available {
                Text(incident.summary.evidenceState.presentation.text).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            }
            ForEach(incident.summary.evidenceState == .available ? incident.evidence : []) { item in
                Button {
                    playing = item
                } label: {
                    HStack {
                        Label(item.isVideo ? L("Evidence clip") : L("Evidence frame"),
                              systemImage: item.isVideo ? "film" : "photo")
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption)
                    }
                    .rgTapTarget()
                }
                .buttonStyle(.plain)
            }
            if incident.summary.evidenceState == .expired {
                FieldHint(text: L("Evidence has expired under the retention policy and is no longer available."))
            }
        }
        .rgCard()

        // Outcome
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Outcome"))
            if let outcome = incident.summary.outcome {
                outcome.presentation.badge
                if let observed = incident.observedBehavior, !observed.isEmpty {
                    KeyValueRow(label: L("Observed behavior"), value: observed)
                }
                if let loss = incident.lossValue {
                    KeyValueRow(label: L("Loss value"), value: money(loss.value, incident.currency))
                }
                if let recovered = incident.recoveredValue {
                    KeyValueRow(label: L("Recovered value"), value: money(recovered.value, incident.currency))
                }
            } else {
                Text(L("No outcome recorded yet. Outcomes are recorded by a human reviewer, never by the model."))
                    .font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            }
            ForEach(incident.reviews) { review in
                VStack(alignment: .leading, spacing: 2) {
                    Text([TimelineActionName.title(review.action), review.outcome?.title].compactMap { $0 }.joined(separator: " · "))
                        .font(.subheadline.weight(.semibold))
                    if let reason = review.reason, !reason.isEmpty { Text(reason).font(.subheadline) }
                    Text([review.actor?.displayName, appState.format(review.createdAt, storeId: incident.summary.storeId)]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Color.rgSecondaryText)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
            IncidentActionBar(incident: incident, controller: controller, sheet: $sheet)
        }
        .rgCard()

        notesSection(incident)

        // History
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("History"))
            ForEach(Array(incident.timeline.enumerated()), id: \.offset) { _, entry in
                HStack(alignment: .firstTextBaseline) {
                    Text(appState.format(entry.at, storeId: incident.summary.storeId, style: .timeWithSeconds))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Color.rgSecondaryText)
                    Text(TimelineActionName.title(entry.action)).font(.subheadline)
                    Spacer()
                    if let actor = entry.actor?.displayName { Text(actor).font(.caption) }
                }
                .accessibilityElement(children: .combine)
            }
            KeyValueRow(label: L("Version"), value: String(incident.version))
        }
        .rgCard()

        // Related visits & cases
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Related visits"))
            Button {
                appState.open(.visits(incident.id))
            } label: {
                HStack {
                    Label(L("Visit timeline"), systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption)
                }
                .rgTapTarget()
            }
            .buttonStyle(.plain)
            if !incident.cases.isEmpty {
                Text(L("Cases")).font(.subheadline.weight(.semibold))
                ForEach(incident.cases) { item in
                    Label(item.ref, systemImage: "folder").font(.subheadline)
                }
                FieldHint(text: L("Case management is available in the web console."))
            }
            if incident.summary.status == .resolved, incident.summary.outcome == .confirmed,
               incident.summary.channel != .unrecognized, appState.can(.watchlistManage) {
                Button {
                    appState.open(.subjectEnroll)
                } label: {
                    Label(L("Enroll subject"), systemImage: "person.badge.plus")
                }
                .buttonStyle(.rgSecondaryWide)
                FieldHint(text: L("Enrollment requires reference photos, a store scope, an expiry and approval by another reviewer."))
            }
        }
        .rgCard()
    }

    private func notesSection(_ incident: Incident) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Notes"))
            if incident.notes.isEmpty {
                Text(L("No notes yet.")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            }
            ForEach(incident.notes) { note in
                VStack(alignment: .leading, spacing: 2) {
                    Text(note.body).font(.subheadline)
                    Text([note.author?.displayName, appState.format(note.createdAt, storeId: incident.summary.storeId)]
                        .compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(Color.rgSecondaryText)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)
            }
            if controller.allowed(appState).contains(.addNote) {
                TextField(L("Add a factual note"), text: $noteText, axis: .vertical)
                    .lineLimit(2...6)
                    .padding(10)
                    .background(Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: 10))
                if let noteError { ErrorBanner(error: noteError) }
                Button {
                    Task { await addNote(incident) }
                } label: {
                    HStack {
                        if noteBusy { ProgressView() }
                        Text(L("Add note"))
                    }
                }
                .buttonStyle(.rgSecondary)
                .disabled(noteBusy)
            }
        }
        .rgCard()
    }

    private func money(_ value: Decimal, _ currency: String?) -> String {
        guard let currency else { return value.formatted() }
        return value.formatted(.currency(code: currency).locale(Localizer.locale))
    }

    private func addNote(_ incident: Incident) async {
        let body = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else {
            noteError = UserFacingError(kind: .validation(["body": "required"]), message: L("Enter a note."), requestId: nil)
            return
        }
        noteBusy = true
        defer { noteBusy = false }
        do {
            try await appState.api.addNote(incidentId: incident.id, body: body)
            noteText = ""
            noteError = nil
            await controller.load(appState, silently: true)
        } catch {
            noteError = appState.present(error)
        }
    }
}

/// ios-25 — Visit timeline. Cross-camera association needs re-identification,
/// which the server reports as unavailable; only this incident's own camera
/// events are listed and nothing is associated across visits.
struct VisitTimelineView: View {
    @Environment(AppState.self) private var appState
    let incidentId: String
    @State private var state: Loadable<VisitTimeline> = .idle
    @State private var storeId: String?

    var body: some View {
        ScreenScaffold(title: L("Visit timeline")) {
            LoadableView(state: state, retry: load) { visit in
                if !visit.available {
                    UnavailableStateView(
                        title: L("Visit association unavailable"),
                        message: visit.reason == APIErrorCode.reidUnavailable
                            ? L("Linking a person across Entrance, Aisle, Checkout and Exit cameras requires re-identification, which is not installed. No association is shown or guessed.")
                            : AppState.unavailableMessage(visit.reason ?? ""),
                        retry: load)
                }
                VStack(alignment: .leading, spacing: 8) {
                    SectionTitle(text: visit.available ? L("Candidate associations") : L("Events in this incident"))
                    if visit.events.isEmpty {
                        Text(L("No camera events were reported.")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
                    }
                    ForEach(Array(visit.events.enumerated()), id: \.offset) { _, event in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "video").foregroundStyle(Color.rgPrimary).accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.cameraName ?? L("Camera")).font(.subheadline.weight(.semibold))
                                Text([event.kind.map { TimelineActionName.title($0) },
                                      event.at.map { appState.format($0, storeId: storeId, style: .timeWithSeconds) }]
                                    .compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(Color.rgSecondaryText)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                    KeyValueRow(label: L("Association uncertainty"),
                                value: visit.available ? L("Candidate links require reviewer confirmation") : L("Not assessed"))
                }
                .rgCard()
            }
        }
        .refreshable { await load() }
        .task { if case .idle = state { await load() } }
    }

    private func load() async {
        state = .loading
        do {
            async let visit = appState.api.visit(incidentId: incidentId)
            async let incident = appState.api.incident(id: incidentId)
            let (v, i) = try await (visit, incident)
            storeId = i.summary.storeId
            state = .loaded(v)
        } catch {
            state = .failed(appState.present(error))
        }
    }
}
