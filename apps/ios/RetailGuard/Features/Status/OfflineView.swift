import SwiftUI
import RetailGuardCore

/// ios-31 — Offline mode: last successful sync, short-lived redacted inbox
/// snapshot, pending drafts (refresh before submission) and reconnect.
/// Mutations are not offered while offline.
struct OfflineView: View {
    @Environment(AppState.self) private var appState
    @State private var reconnecting = false
    @State private var reconnectMessage: String?
    @State private var draftStatus: [UUID: String] = [:]
    @State private var openDraft: OutcomeDraft?
    @State private var refreshing: UUID?

    var body: some View {
        ScreenScaffold(title: L("Offline mode"), showsStoreSubtitle: false) {
            statusCard
            draftsCard
            snapshotCard
        }
        .sheet(item: $openDraft) { draft in
            DraftOutcomeSheet(draft: draft)
        }
    }

    private var userId: String? { appState.userId }

    private var statusCard: some View {
        VStack(spacing: 12) {
            Image(systemName: appState.network.isOnline ? "checkmark.icloud" : "arrow.clockwise.icloud")
                .font(.system(.largeTitle))
                .foregroundStyle(Color.rgPrimary)
                .accessibilityHidden(true)
            Text(appState.network.isOnline ? L("Connected") : L("Offline mode"))
                .font(.title2.bold())
            Text(appState.network.isOnline
                 ? L("You're connected. Refresh drafts before submitting them.")
                 : L("Latest records are unavailable. Reconnect and refresh before taking action."))
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.rgSecondaryText)
            KeyValueRow(label: L("Last synced"),
                        value: appState.format(lastSync, storeId: appState.selectedStoreId, style: .dateTime))
            KeyValueRow(label: L("Pending draft"), value: String(drafts.count),
                        valueTone: drafts.isEmpty ? nil : .warning)
            if let reconnectMessage { FieldHint(text: reconnectMessage) }
            Button {
                Task { await reconnect() }
            } label: {
                HStack {
                    if reconnecting { ProgressView().tint(Color.rgOnPrimary) }
                    Text(L("Reconnect"))
                }
            }
            .buttonStyle(.rgPrimary)
            .disabled(reconnecting)
        }
        .frame(maxWidth: .infinity)
        .rgCard()
    }

    private var drafts: [OutcomeDraft] {
        userId.map { appState.drafts.drafts(for: $0) } ?? []
    }

    private var lastSync: Date? {
        appState.lastSyncAt ?? userId.flatMap { appState.snapshots.load(userId: $0)?.syncedAt }
    }

    private var draftsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Pending draft"))
            if drafts.isEmpty {
                FieldHint(text: L("No unsent drafts on this device."))
            }
            ForEach(drafts) { draft in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(draft.incidentRef).font(.headline)
                        Spacer()
                        if let outcome = draft.form.outcome { outcome.presentation.badge }
                    }
                    Text(LF("Saved %@ against version %@.", appState.format(draft.updatedAt, storeId: draft.storeId, style: .dateTime),
                            String(draft.baseVersion)))
                        .font(.caption).foregroundStyle(Color.rgSecondaryText)
                    if draft.refreshRequired {
                        StatusBadge(text: L("Refresh before submission"), systemImage: "arrow.clockwise", tone: .warning)
                    } else {
                        StatusBadge(text: L("Checked against latest version"), systemImage: "checkmark.circle", tone: .success)
                    }
                    if let conflicting = draft.conflictingVersion {
                        FieldHint(text: LF("The incident changed (now version %@). Review the current state before using this draft.", String(conflicting)))
                    }
                    if let status = draftStatus[draft.id] { FieldHint(text: status) }
                    if appState.network.isOnline {
                        HStack {
                            Button {
                                Task { await refresh(draft) }
                            } label: {
                                HStack {
                                    if refreshing == draft.id { ProgressView() }
                                    Text(L("Refresh"))
                                }
                            }
                            .buttonStyle(.rgSecondary)
                            Button(L("Review and submit")) { openDraft = draft }
                                .buttonStyle(.rgPrimary)
                        }
                    }
                    Button(L("Discard draft"), role: .destructive) {
                        try? appState.drafts.remove(id: draft.id)
                        draftStatus[draft.id] = nil
                    }
                    .font(.subheadline)
                    .rgTapTarget()
                }
                .padding(.vertical, 6)
                Divider()
            }
            FieldHint(text: L("Drafts are kept on this device for up to 24 hours and are always checked against the latest incident before submission."))
        }
        .rgCard()
    }

    @ViewBuilder private var snapshotCard: some View {
        if let userId, let snapshot = appState.snapshots.load(userId: userId), !snapshot.incidents.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: L("Last synced alerts"))
                FieldHint(text: L("Redacted summary from the last sync. It may be out of date; do not act on it without refreshing."))
                ForEach(snapshot.incidents) { item in
                    HStack {
                        Image(systemName: item.channel.systemImage).foregroundStyle(Color.rgPrimary).accessibilityHidden(true)
                        VStack(alignment: .leading) {
                            Text(item.ref).font(.subheadline.weight(.semibold))
                            Text([item.channel.title, appState.format(item.capturedAt, storeId: item.storeId, style: .time)]
                                .joined(separator: " · "))
                                .font(.caption).foregroundStyle(Color.rgSecondaryText)
                        }
                        Spacer()
                        item.status.presentation.badge
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .rgCard()
        }
    }

    private func reconnect() async {
        reconnecting = true
        defer { reconnecting = false }
        if appState.phase == .offlineLaunch {
            await appState.resumeSession()
            reconnectMessage = appState.network.isOnline ? nil : L("Still offline. Check Wi-Fi or cellular data.")
            return
        }
        await appState.refreshMe()
        if appState.network.isOnline {
            try? appState.drafts.requireRefreshForAll()
            appState.requestInboxReload()
            reconnectMessage = L("Connected. Refresh each draft before submitting it.")
        } else {
            reconnectMessage = L("Still offline. Check Wi-Fi or cellular data.")
        }
    }

    private func refresh(_ draft: OutcomeDraft) async {
        guard let userId else { return }
        refreshing = draft.id
        defer { refreshing = nil }
        let submitter = DraftSubmitter(service: appState.api, store: appState.drafts, userId: userId,
                                       permissions: appState.permissions)
        do {
            let (updated, current) = try await submitter.refresh(draftId: draft.id)
            draftStatus[draft.id] = updated.refreshRequired
                ? LF("The incident is now %@ (version %@).", current.status.presentation.text, String(current.version))
                : L("No changes since the draft was saved. Ready to review and submit.")
        } catch DraftSubmissionError.api(let error) {
            draftStatus[draft.id] = appState.present(error).message
        } catch {
            draftStatus[draft.id] = L("The draft expired or was removed.")
        }
    }
}

/// Loads the incident for a draft and presents the outcome form (ios-12),
/// which submits through the refresh-before-submit path.
struct DraftOutcomeSheet: View {
    @Environment(AppState.self) private var appState
    let draft: OutcomeDraft
    @State private var controller: IncidentController

    init(draft: OutcomeDraft) {
        self.draft = draft
        _controller = State(initialValue: IncidentController(incidentId: draft.incidentId))
    }

    var body: some View {
        OutcomeView(controller: controller, draft: draft)
            .task { await controller.load(appState) }
    }
}
