import SwiftUI
import Charts
import RetailGuardCore

/// ios-07 — Store overview from `GET /v1/dashboard`. Unavailable values are
/// shown as such (never as zero); every metric links to filtered records.
struct HomeView: View {
    @Environment(AppState.self) private var appState
    @State private var state: Loadable<Dashboard> = .idle
    @State private var myAssignments: AssignmentCount?

    struct AssignmentCount: Equatable {
        let count: Int
        let more: Bool
    }

    var body: some View {
        ScreenScaffold(title: L("Store overview")) {
            if !appState.can(.dashboardRead) {
                PermissionDeniedView()
            } else {
                LoadableView(state: state, retry: load) { dashboard in
                    content(dashboard)
                }
            }
            toolsSection
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    appState.open(.storeSelection)
                } label: {
                    Label(appState.storeTitle, systemImage: "building.2")
                        .labelStyle(.titleAndIcon)
                        .lineLimit(1)
                }
                .accessibilityLabel(LF("Store: %@", appState.storeTitle))
                .accessibilityHint(L("Changes the selected store"))
            }
        }
        .refreshable { await load() }
        .task(id: "\(appState.selectedStoreId ?? "all")-\(appState.inboxRevision)") { await load() }
    }

    @ViewBuilder
    private func content(_ dashboard: Dashboard) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
            MetricTile(title: L("Open alerts"), value: String(dashboard.openAlerts),
                       caption: L("Live from the server"), systemImage: "bell.badge") {
                appState.selectedTab = .alerts
            }
            MetricTile(title: L("Online cameras"), value: "\(dashboard.cameras.online)/\(dashboard.cameras.total)",
                       caption: dashboard.cameras.total == 0 ? L("No cameras configured") : L("Ready to stream"),
                       systemImage: "video") {
                appState.open(.cameras, in: .home)
            }
            MetricTile(title: L("My assignments"),
                       value: myAssignments.map { $0.more ? "\($0.count)+" : String($0.count) } ?? "—",
                       caption: myAssignments == nil ? L("Not available") : L("Open incidents you own"),
                       systemImage: "person.badge.clock") {
                appState.paths[.alerts] = []
                appState.alertFilter = .assignedToMe
                appState.selectedTab = .alerts
            }
            MetricTile(title: L("Today’s reviewed incidents"), value: String(dashboard.reviewedToday),
                       caption: medianCaption(dashboard.medianAckSeconds), systemImage: "checkmark.seal") {
                appState.selectedTab = .history
            }
        }

        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: L("Alerts awaiting review"))
            if dashboard.awaitingReview.isEmpty {
                Text(L("No pending alerts")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            } else {
                ForEach(dashboard.awaitingReview) { incident in
                    Button {
                        appState.open(.alertDetail(incident.id), in: .home)
                    } label: {
                        IncidentRow(incident: incident)
                    }
                    .buttonStyle(.plain)
                    if incident.id != dashboard.awaitingReview.last?.id { Divider() }
                }
            }
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: L("Alert and review trends"))
            if dashboard.trend.isEmpty {
                Text(L("No trend data for this period.")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            } else {
                Chart {
                    ForEach(dashboard.trend) { point in
                        BarMark(x: .value(L("Date"), point.date), y: .value(L("Count"), point.detections))
                            .foregroundStyle(by: .value(L("Series"), L("Detections")))
                            .position(by: .value(L("Series"), L("Detections")))
                        BarMark(x: .value(L("Date"), point.date), y: .value(L("Count"), point.reviewed))
                            .foregroundStyle(by: .value(L("Series"), L("Reviewed")))
                            .position(by: .value(L("Series"), L("Reviewed")))
                    }
                }
                .chartForegroundStyleScale([L("Detections"): Color.rgPrimary, L("Reviewed"): Color.rgAccent])
                .chartXAxis {
                    AxisMarks { value in
                        AxisValueLabel(String((value.as(String.self) ?? "").suffix(5)))
                    }
                }
                .frame(minHeight: 180)
            }
            InfoBanner(text: L("Detections are AI candidate signals. Impact is measured only from human-reviewed incidents."),
                       tone: .warning, systemImage: "info.circle")
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Camera health"))
            if dashboard.cameraHealth.isEmpty {
                Text(L("No cameras configured")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            }
            ForEach(dashboard.cameraHealth) { camera in
                Button {
                    appState.open(.camera(camera.id), in: .home)
                } label: {
                    HStack {
                        Text(camera.name).font(.subheadline).foregroundStyle(Color.rgInk)
                        Spacer()
                        camera.readiness.presentation.badge
                        camera.analysisState.presentation.badge
                    }
                    .rgTapTarget()
                }
                .buttonStyle(.plain)
            }
        }
        .rgCard()

        Text(LF("Last refreshed %@", appState.format(dashboard.lastRefresh, storeId: appState.selectedStoreId, style: .timeWithSeconds)))
            .font(.caption)
            .foregroundStyle(Color.rgSecondaryText)
    }

    private var toolsSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: L("Store tools"))
            if appState.can(.cameraRead) {
                toolRow(L("Cameras"), "video", .cameras)
            }
            toolRow(L("Response team"), "person.3", .team)
            if appState.can(.profileRead) {
                toolRow(L("title.watchlist"), "person.crop.rectangle.stack", .watchlist)
                toolRow(L("Staff"), "person.text.rectangle", .staff)
            }
            toolRow(L("Offline mode"), "arrow.triangle.2.circlepath", .offline)
        }
        .rgCard()
    }

    private func toolRow(_ title: String, _ icon: String, _ route: Route) -> some View {
        Button {
            appState.open(route, in: .home)
        } label: {
            HStack {
                Label(title, systemImage: icon).foregroundStyle(Color.rgInk)
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.rgSecondaryText)
            }
            .rgTapTarget()
        }
        .buttonStyle(.plain)
    }

    private func medianCaption(_ seconds: Double?) -> String {
        guard let seconds else { return L("Median acknowledgement: not enough data") }
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = seconds >= 60 ? [.minute, .second] : [.second]
        formatter.calendar?.locale = Localizer.locale
        return LF("Median acknowledgement: %@", formatter.string(from: seconds) ?? "—")
    }

    private func load() async {
        guard appState.can(.dashboardRead) else { return }
        if state.value == nil { state = .loading }
        do {
            let dashboard = try await appState.api.dashboard(storeId: appState.selectedStoreId)
            state = .loaded(dashboard)
        } catch {
            let failure = appState.present(error)
            if state.value == nil || failure.kind != .offline { state = .failed(failure) }
        }
        await loadAssignments()
    }

    private func loadAssignments() async {
        guard appState.can(.incidentRead) else { myAssignments = nil; return }
        do {
            async let acknowledged = appState.api.incidents(IncidentQuery(storeId: appState.selectedStoreId, status: .acknowledged, assignee: "me", limit: 100))
            async let reviewing = appState.api.incidents(IncidentQuery(storeId: appState.selectedStoreId, status: .reviewing, assignee: "me", limit: 100))
            let (a, r) = try await (acknowledged, reviewing)
            myAssignments = AssignmentCount(count: a.items.count + r.items.count, more: a.nextCursor != nil || r.nextCursor != nil)
        } catch {
            myAssignments = nil
        }
    }
}

/// Inbox row: reference, type, camera, time, status — text + icon.
struct IncidentRow: View {
    @Environment(AppState.self) private var appState
    let incident: IncidentSummary

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: incident.channel.systemImage)
                .font(.title3)
                .foregroundStyle(Color.rgPrimary)
                .frame(width: 44, height: 44)
                .background(Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(incident.ref).font(.headline).foregroundStyle(Color.rgInk)
                Text([incident.channel.title, incident.cameraName, appState.format(incident.capturedAt, storeId: incident.storeId, style: .time)]
                    .compactMap { $0 }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(Color.rgSecondaryText)
                HStack(spacing: 6) {
                    incident.status.presentation.badge
                    if incident.priority == .high || incident.priority == .urgent {
                        incident.priority?.presentation.badge
                    }
                    if incident.evidenceState != .available {
                        incident.evidenceState.presentation.badge
                    }
                    if incident.delayed {
                        StatusBadge(text: L("Delayed delivery"), systemImage: "clock.arrow.circlepath", tone: .warning)
                    }
                }
                if let assignee = incident.assignee {
                    Text(LF("Assignee: %@", assignee.id == appState.userId ? L("You") : assignee.displayName))
                        .font(.caption)
                        .foregroundStyle(Color.rgSecondaryText)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.rgSecondaryText)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(L("Opens the alert"))
    }
}
