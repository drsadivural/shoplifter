import SwiftUI
import RetailGuardCore

/// Wraps response forms in a navigation stack for sheet presentation.
private struct SheetFrame<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader(title: title, subtitle: nil)
                content()
            }
            .padding(RGMetrics.gutter)
        }
        .background(Color.rgBackground.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
    }
}

// MARK: - ios-11 Take ownership

struct AcknowledgeView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let controller: IncidentController
    @State private var busy = false
    @State private var error: UserFacingError?

    var body: some View {
        NavigationStack {
            SheetFrame(title: L("Take ownership")) {
                if let incident = controller.incident {
                    VStack(alignment: .leading, spacing: 4) {
                        KeyValueRow(label: L("Incident"), value: incident.summary.ref)
                        KeyValueRow(label: L("Assigned responder"), value: assignee(incident))
                        KeyValueRow(label: L("Current version"), value: String(incident.version))
                        KeyValueRow(label: L("Status"), value: incident.status.presentation.text)
                    }
                    .rgCard()
                    Text(L("Acknowledging assigns this alert to you so other responders see that it is being handled. It does not confirm any wrongdoing."))
                        .font(.subheadline)
                        .foregroundStyle(Color.rgSecondaryText)
                    if let error { ErrorBanner(error: error) }
                    if controller.conflict != nil {
                        ConflictBanner(controller: controller)
                    }
                    let allowed = controller.allowed(appState)
                    if allowed.contains(.claim) {
                        Button {
                            Task { await acknowledge() }
                        } label: {
                            HStack {
                                if busy { ProgressView().tint(Color.rgOnPrimary) }
                                Text(L("Acknowledge"))
                            }
                        }
                        .buttonStyle(.rgPrimaryWide)
                        .disabled(busy)
                    }
                    if allowed.contains(.escalate) {
                        NavigationLink {
                            EscalateView(controller: controller, embedded: true)
                        } label: {
                            Text(L("Escalate"))
                        }
                        .buttonStyle(.rgSecondaryWide)
                    }
                } else {
                    LoadingStateView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
            }
        }
    }

    private func assignee(_ incident: Incident) -> String {
        guard let assignee = incident.summary.assignee else { return L("Unassigned") }
        return assignee.id == appState.userId ? L("You") : assignee.displayName
    }

    private func acknowledge() async {
        busy = true
        defer { busy = false }
        error = await controller.perform(appState, success: L("You now own this alert.")) { api, version in
            try await api.claim(incidentId: controller.incidentId, expectedVersion: version)
        }
        if error == nil { dismiss() }
    }
}

// MARK: - ios-12 Record outcome

struct OutcomeView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let controller: IncidentController
    let draft: OutcomeDraft?

    @State private var form = OutcomeForm()
    @State private var fieldErrors: [String: OutcomeFieldError] = [:]
    @State private var busy = false
    @State private var error: UserFacingError?
    @State private var draftConflict: Incident?
    @State private var draftMessage: String?
    @State private var loadedDraft = false

    var body: some View {
        NavigationStack {
            SheetFrame(title: L("Record outcome")) {
                if let incident = controller.incident {
                    formContent(incident)
                } else {
                    LoadingStateView()
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
            }
        }
        .onAppear {
            guard !loadedDraft else { return }
            loadedDraft = true
            if let draft { form = draft.form }
        }
    }

    @ViewBuilder
    private func formContent(_ incident: Incident) -> some View {
        if let draft {
            InfoBanner(text: LF("Editing a draft saved against version %@. It will be checked against the latest incident before submission.", String(draft.baseVersion)),
                       tone: .info, systemImage: "doc.badge.clock")
        }
        if let draftConflict {
            draftConflictCard(draftConflict)
        }
        ConflictBanner(controller: controller)

        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: L("Outcome"))
            ForEach(Outcome.selectable, id: \.self) { outcome in
                outcomeOption(outcome, incident: incident)
            }
            FieldError(text: fieldErrors["outcome"].map(message))

            LabeledInput(label: L("Reason"), hint: L("Required. Describe what you verified."),
                         error: fieldErrors["reason"].map(message)) {
                TextField(L("Required"), text: $form.reason, axis: .vertical)
                    .lineLimit(3...8)
                    .padding(.vertical, 8)
            }
            LabeledInput(label: L("Observed behavior"), hint: L("Optional. Facts you observed, not conclusions."), error: nil) {
                TextField(L("Optional"), text: $form.observedBehavior, axis: .vertical)
                    .lineLimit(2...6)
                    .padding(.vertical, 8)
            }
            LabeledInput(label: LF("Loss value (%@)", incident.currency ?? "—"), hint: L("Optional. Leave empty if unknown."),
                         error: fieldErrors["loss_value"].map(message)) {
                TextField("0", text: $form.lossValue)
                    .keyboardType(.decimalPad)
            }
            LabeledInput(label: LF("Recovered value (%@)", incident.currency ?? "—"), hint: L("Optional."),
                         error: fieldErrors["recovered_value"].map(message)) {
                TextField("0", text: $form.recoveredValue)
                    .keyboardType(.decimalPad)
            }
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Review before saving"))
            KeyValueRow(label: L("Outcome"), value: form.outcome?.title ?? L("Select option"))
            KeyValueRow(label: L("Incident"), value: "\(incident.summary.ref) · v\(incident.version)")
            HumanReviewNotice()
            Text(L("Saved changes appear in the audit log."))
                .font(.caption)
                .foregroundStyle(Color.rgSecondaryText)
        }
        .rgCard()

        if let error { ErrorBanner(error: error) }
        if let draftMessage { InfoBanner(text: draftMessage, tone: .info, systemImage: "tray.and.arrow.down") }

        HStack {
            Button {
                Task { await save() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(Color.rgOnPrimary) }
                    Text(L("Save"))
                }
            }
            .buttonStyle(.rgPrimary)
            .disabled(busy)
            Button(L("Save draft")) { saveDraft(incident, announce: true) }
                .buttonStyle(.rgSecondary)
                .disabled(busy)
        }
    }

    private func outcomeOption(_ outcome: Outcome, incident: Incident) -> some View {
        let selected = form.outcome == outcome
        let blocked = outcome == .confirmed && incident.summary.evidenceState == .pending
        return Button {
            form.outcome = outcome
            fieldErrors["outcome"] = nil
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? Color.rgPrimary : Color.rgSecondaryText)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(outcome.title).font(.headline).foregroundStyle(Color.rgInk)
                    Text(outcome.explanation).font(.caption).foregroundStyle(Color.rgSecondaryText)
                    if blocked {
                        Text(L("Requires available evidence; evidence is still pending."))
                            .font(.caption).foregroundStyle(Color.rgWarning)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(minHeight: RGMetrics.minTapTarget)
            .background(selected ? Tone.info.background : Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private func draftConflictCard(_ current: Incident) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(L("Updated by someone else"), systemImage: "arrow.triangle.2.circlepath")
                .font(.headline).foregroundStyle(Color.rgWarning)
            Text(LF("Current state: %@, version %@, assignee %@.", current.status.presentation.text, String(current.version),
                    current.summary.assignee?.displayName ?? L("Unassigned")))
                .font(.subheadline)
            Text(L("Your draft was not submitted. Review the current incident before deciding."))
                .font(.caption).foregroundStyle(Color.rgSecondaryText)
            if let draft, let userId = appState.userId,
               IncidentActions.denial(for: .recordOutcome,
                                      IncidentActionContext(summary: current.summary, userId: userId,
                                                            permissions: appState.permissions)) == nil {
                Button(LF("Apply my draft to version %@", String(current.version))) {
                    _ = try? appState.drafts.rebase(draftId: draft.id, onto: current.version)
                    draftConflict = nil
                    draftMessage = L("Draft moved to the current version. Check it, then save.")
                }
                .buttonStyle(.rgSecondary)
            }
            if let draft {
                Button(L("Discard draft"), role: .destructive) {
                    try? appState.drafts.remove(id: draft.id)
                    dismiss()
                }
                .buttonStyle(.rgDestructive)
            }
        }
        .rgCard()
    }

    private func message(_ error: OutcomeFieldError) -> String {
        switch error {
        case .outcomeRequired: return L("Select an outcome.")
        case .reasonRequired: return L("Enter a reason.")
        case .reasonTooLong: return L("The reason is too long.")
        case .invalidAmount: return L("Enter a non-negative amount with up to 2 decimals.")
        case .evidencePending: return L("Confirmed cannot be recorded while evidence is pending.")
        }
    }

    @discardableResult
    private func saveDraft(_ incident: Incident, announce: Bool) -> OutcomeDraft? {
        guard let userId = appState.userId else { return nil }
        let base = draft.flatMap { appState.drafts.draft(id: $0.id)?.baseVersion } ?? incident.version
        let saved = try? appState.drafts.save(userId: userId, incidentId: incident.id, incidentRef: incident.summary.ref,
                                              storeId: incident.summary.storeId, baseVersion: base, form: form)
        if announce {
            draftMessage = saved == nil
                ? L("The draft could not be saved on this device.")
                : L("Saved as a draft on this device. It will be checked against the latest incident before submission.")
        }
        return saved
    }

    private func save() async {
        guard let incident = controller.incident else { return }
        error = nil
        draftMessage = nil
        fieldErrors = form.validate(evidenceState: incident.summary.evidenceState)
        guard fieldErrors.isEmpty else { return }

        // Offline: keep a draft instead of sending a stale command.
        if !appState.network.isOnline {
            saveDraft(incident, announce: true)
            return
        }

        busy = true
        defer { busy = false }

        // Drafts always go through refresh-before-submit.
        if draft != nil || appState.userId.flatMap({ appState.drafts.draft(incidentId: incident.id, userId: $0) }) != nil {
            guard let saved = saveDraft(incident, announce: false), let userId = appState.userId else { return }
            let submitter = DraftSubmitter(service: appState.api, store: appState.drafts, userId: userId,
                                           permissions: appState.permissions)
            do {
                _ = try await submitter.submit(draftId: saved.id)
                await controller.load(appState, silently: true)
                appState.requestInboxReload()
                dismiss()
            } catch let failure as DraftSubmissionError {
                switch failure {
                case .conflict(let current):
                    draftConflict = current
                    await controller.load(appState, silently: true)
                case .notAllowed(let current, _):
                    draftConflict = current
                    await controller.load(appState, silently: true)
                case .invalid(let errors):
                    fieldErrors = errors
                case .api(let apiError):
                    let presented = appState.present(apiError)
                    error = presented
                    if presented.kind == .offline {
                        draftMessage = L("Saved as a draft on this device. It will be checked against the latest incident before submission.")
                    }
                case .draftMissing:
                    error = UserFacingError(kind: .notFound, message: L("The draft expired or was removed."), requestId: nil)
                }
            } catch {
                self.error = appState.present(error)
            }
            return
        }

        guard let command = form.command(expectedVersion: incident.version) else { return }
        let failure = await controller.perform(appState, success: L("Outcome recorded.")) { api, _ in
            try await api.recordOutcome(incidentId: controller.incidentId, command: command)
        }
        if let failure {
            error = failure
            if failure.kind == .offline {
                saveDraft(incident, announce: true)
            }
        } else {
            dismiss()
        }
    }
}

// MARK: - ios-13 Request assistance

struct EscalateView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let controller: IncidentController
    var embedded = false

    @State private var priority: Priority = .high
    @State private var reason = ""
    @State private var reasonError: String?
    @State private var busy = false
    @State private var error: UserFacingError?
    @State private var team: Loadable<[TeamMember]> = .idle

    var body: some View {
        if embedded {
            content
        } else {
            NavigationStack {
                content.toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                }
            }
        }
    }

    private var content: some View {
        SheetFrame(title: L("Request assistance")) {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: L("Assigned team"))
                switch team {
                case .idle, .loading:
                    ProgressView()
                case .failed(let failure):
                    FieldHint(text: failure.message)
                case .loaded(let members):
                    let onDuty = members.filter(\.onDuty)
                    if onDuty.isEmpty {
                        FieldHint(text: L("No one is marked on duty. The store's escalation policy still routes the request."))
                    }
                    ForEach(onDuty) { member in
                        HStack {
                            Label(member.displayName, systemImage: "person.fill.checkmark")
                            Spacer()
                            Text(member.role.title).font(.caption).foregroundStyle(Color.rgSecondaryText)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                FieldHint(text: L("Notify backup: backup responders are notified automatically according to the store's escalation policy."))
            }
            .rgCard()

            VStack(alignment: .leading, spacing: 12) {
                Text(L("Priority")).font(.subheadline.weight(.semibold))
                Picker(L("Priority"), selection: $priority) {
                    ForEach(Priority.selectable, id: \.self) { value in
                        Text(value.title).tag(value)
                    }
                }
                .pickerStyle(.segmented)
                LabeledInput(label: L("Reason"), hint: L("Required. What help is needed?"), error: reasonError) {
                    TextField(L("Required"), text: $reason, axis: .vertical)
                        .lineLimit(3...6)
                        .padding(.vertical, 8)
                }
            }
            .rgCard()

            if let error { ErrorBanner(error: error) }
            ConflictBanner(controller: controller)

            Button {
                Task { await submit() }
            } label: {
                HStack {
                    if busy { ProgressView().tint(Color.rgOnPrimary) }
                    Text(L("Request assistance"))
                }
            }
            .buttonStyle(.rgPrimaryWide)
            .disabled(busy)
        }
        .task {
            guard case .idle = team else { return }
            team = .loading
            do {
                team = .loaded(try await appState.api.team(storeId: controller.incident?.summary.storeId ?? appState.selectedStoreId))
            } catch {
                team = .failed(appState.present(error))
            }
        }
    }

    private func submit() async {
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            reasonError = L("Enter a reason.")
            return
        }
        reasonError = nil
        busy = true
        defer { busy = false }
        error = await controller.perform(appState, success: L("Assistance requested.")) { api, version in
            try await api.escalate(incidentId: controller.incidentId,
                                   command: EscalateCommand(expectedVersion: version, reason: trimmed, priority: priority))
        }
        if error == nil { dismiss() }
    }
}
