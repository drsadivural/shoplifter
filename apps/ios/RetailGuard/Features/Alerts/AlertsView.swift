import SwiftUI
import RetailGuardCore

/// Inbox type filter (ios-08 fields: Behavior, Watchlist, Checkout, Assigned to me).
enum AlertFilter: Hashable, CaseIterable {
    case all, behavior, watchlist, checkout, rfid, assignedToMe

    var title: String {
        switch self {
        case .all: return L("All")
        case .behavior: return L("Behavior")
        case .watchlist: return L("Watchlist")
        case .checkout: return L("Checkout")
        case .rfid: return L("RFID")
        case .assignedToMe: return L("Assigned to me")
        }
    }

    var channel: IncidentChannel? {
        switch self {
        case .behavior: return .behaviorCandidate
        case .watchlist: return .watchlistCandidate
        case .checkout: return .checkoutException
        case .rfid: return .rfidException
        default: return nil
        }
    }

    var defaultStatus: IncidentStatus? {
        self == .assignedToMe ? .acknowledged : .new
    }
}

/// ios-08 — Live alerts: scoped, paginated inbox polled while visible.
/// Acknowledgement is never inferred from push delivery.
struct AlertsView: View {
    @Environment(AppState.self) private var appState
    @State private var state: Loadable<[IncidentSummary]> = .idle
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var status: IncidentStatus? = .new
    @State private var statusIsDefault = true
    @State private var searchText = ""

    private let pollInterval: Duration = .seconds(30)

    var body: some View {
        ScreenScaffold(title: L("Live alerts")) {
            if !appState.can(.incidentRead) {
                PermissionDeniedView()
            } else {
                filterBar
                LoadableView(state: state, retry: { await load() }) { items in
                    if items.isEmpty {
                        if isDefaultView {
                            AllCaughtUpView()
                        } else {
                            EmptyStateView(systemImage: "line.3.horizontal.decrease.circle",
                                           title: L("No alerts match these filters"),
                                           message: L("Change the filters or check past records."),
                                           actionTitle: L("Clear filters")) {
                                appState.alertFilter = .all
                                status = AlertFilter.all.defaultStatus
                                statusIsDefault = true
                                searchText = ""
                            }
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(items) { incident in
                                Button {
                                    appState.open(.alertDetail(incident.id), in: .alerts)
                                } label: {
                                    IncidentRow(incident: incident)
                                }
                                .buttonStyle(.plain)
                                if incident.id != items.last?.id { Divider() }
                            }
                            if nextCursor != nil {
                                LoadMoreButton(isLoading: loadingMore) { await loadMore() }
                            }
                            Text(LF("Last synced %@", appState.format(appState.lastSyncAt, storeId: appState.selectedStoreId, style: .timeWithSeconds)))
                                .font(.caption)
                                .foregroundStyle(Color.rgSecondaryText)
                        }
                        .rgCard()
                    }
                }
            }
        }
        .searchable(text: $searchText, prompt: L("Search records"))
        .onSubmit(of: .search) { Task { await load() } }
        .refreshable { await load() }
        .task(id: reloadKey) {
            await load()
            while !Task.isCancelled {
                try? await Task.sleep(for: pollInterval)
                if Task.isCancelled { break }
                await load(silently: true)
            }
        }
        .onChange(of: appState.alertFilter) { _, newValue in
            if statusIsDefault { status = newValue.defaultStatus }
        }
        .onAppear {
            if statusIsDefault { status = appState.alertFilter.defaultStatus }
        }
    }

    private var reloadKey: String {
        "\(appState.selectedStoreId ?? "all")|\(appState.alertFilter)|\(status?.rawValue ?? "any")|\(appState.inboxRevision)"
    }

    private var isDefaultView: Bool {
        appState.alertFilter == .all && status == .new && searchText.isEmpty
    }

    private var filterBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(AlertFilter.allCases, id: \.self) { filter in
                        let selected = appState.alertFilter == filter
                        Button {
                            appState.alertFilter = filter
                        } label: {
                            Text(filter.title)
                                .font(.subheadline.weight(selected ? .semibold : .regular))
                                .padding(.horizontal, 12)
                                .frame(minHeight: RGMetrics.minTapTarget)
                                .foregroundStyle(selected ? Color.rgOnPrimary : Color.rgInk)
                                .background(selected ? Color.rgPrimary : Color.rgSurface, in: Capsule())
                                .overlay(Capsule().strokeBorder(Color.rgBorder, lineWidth: selected ? 0 : 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
            }
            Menu {
                Picker(L("Status"), selection: Binding(get: { status }, set: { status = $0; statusIsDefault = false })) {
                    Text(L("All statuses")).tag(IncidentStatus?.none)
                    ForEach([IncidentStatus.new, .acknowledged, .reviewing, .resolved], id: \.self) { value in
                        Label(value.presentation.text, systemImage: value.presentation.systemImage)
                            .tag(IncidentStatus?.some(value))
                    }
                }
            } label: {
                Label(LF("Status: %@", status?.presentation.text ?? L("All statuses")), systemImage: "line.3.horizontal.decrease.circle")
                    .font(.subheadline)
                    .rgTapTarget()
            }
        }
    }

    private var query: IncidentQuery {
        IncidentQuery(storeId: appState.selectedStoreId,
                      channel: appState.alertFilter.channel,
                      status: status,
                      assignee: appState.alertFilter == .assignedToMe ? "me" : nil,
                      text: searchText.isEmpty ? nil : searchText,
                      limit: 50)
    }

    private func load(silently: Bool = false) async {
        guard appState.can(.incidentRead) else { return }
        if !silently, state.value == nil { state = .loading }
        do {
            let page = try await appState.api.incidents(query)
            nextCursor = page.nextCursor
            state = .loaded(page.items)
            appState.recordInboxSync(page.items)
        } catch {
            let failure = appState.present(error)
            // Keep showing the last loaded list while offline; the banner explains.
            if state.value == nil || (failure.kind != .offline && !silently) {
                state = .failed(failure)
            }
        }
    }

    private func loadMore() async {
        guard let cursor = nextCursor, case .loaded(let existing) = state else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await appState.api.incidents(query, cursor: cursor)
            nextCursor = page.nextCursor
            let known = Set(existing.map(\.id))
            state = .loaded(existing + page.items.filter { !known.contains($0.id) })
        } catch {
            _ = appState.present(error)
        }
    }
}

/// ios-32 — All caught up: a true zero-result state with monitoring status.
struct AllCaughtUpView: View {
    @Environment(AppState.self) private var appState
    @State private var dashboard: Dashboard?
    @State private var dashboardError: UserFacingError?

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.seal")
                .font(.system(.largeTitle))
                .foregroundStyle(Color.rgPrimary)
                .accessibilityHidden(true)
            Text(L("All caught up")).font(.title2.bold()).foregroundStyle(Color.rgInk)
            Text(L("No pending alerts")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)

            VStack(alignment: .leading, spacing: 4) {
                Text(L("Monitoring status")).font(.headline)
                if let dashboard {
                    let analyzing = dashboard.cameraHealth.filter { $0.analysisState == .analyzing }.count
                    KeyValueRow(label: L("Online cameras"), value: "\(dashboard.cameras.online)/\(dashboard.cameras.total)",
                                valueTone: dashboard.cameras.online == dashboard.cameras.total ? .success : .warning)
                    KeyValueRow(label: L("Cameras analyzing"), value: "\(analyzing)/\(dashboard.cameraHealth.count)",
                                valueTone: analyzing == 0 ? .warning : nil)
                    if analyzing == 0 {
                        FieldHint(text: L("No camera is currently analyzing. An empty inbox does not mean the store is being monitored."))
                    }
                } else if let dashboardError {
                    FieldHint(text: dashboardError.message)
                } else if appState.can(.dashboardRead) {
                    ProgressView()
                }
                KeyValueRow(label: L("Last synced"),
                            value: appState.format(appState.lastSyncAt, storeId: appState.selectedStoreId, style: .timeWithSeconds))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(L("View past records")) {
                appState.selectedTab = .history
            }
            .buttonStyle(.rgPrimary)
        }
        .frame(maxWidth: .infinity)
        .rgCard()
        .task(id: appState.selectedStoreId) {
            guard appState.can(.dashboardRead) else { return }
            do {
                dashboard = try await appState.api.dashboard(storeId: appState.selectedStoreId)
                dashboardError = nil
            } catch {
                dashboardError = appState.present(error)
            }
        }
    }
}
