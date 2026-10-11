import SwiftUI
import RetailGuardCore

/// ios-06 — Select store. Lists only stores the server scopes to the user
/// (`GET /v1/stores`, cursor pagination, stable server order).
struct StoreSelectionView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let isOnboarding: Bool

    @State private var state: Loadable<[Store]> = .idle
    @State private var nextCursor: String?
    @State private var loadingMore = false

    var body: some View {
        ScreenScaffold(title: L("Select stores"), subtitle: L("Assigned access only")) {
            LoadableView(state: state, retry: load) { stores in
                if stores.isEmpty {
                    EmptyStateView(systemImage: "building.2",
                                   title: L("No stores assigned"),
                                   message: L("Your account has no store access yet. Ask an administrator to assign stores."))
                } else {
                    VStack(spacing: 12) {
                        if stores.count > 1 {
                            allStoresRow
                        }
                        ForEach(stores) { store in
                            storeRow(store)
                        }
                        if nextCursor != nil {
                            LoadMoreButton(isLoading: loadingMore) { await loadMore() }
                        }
                    }
                }
            }
            InfoBanner(text: L("Only stores assigned to your account are shown. The server enforces the same scope for every request."),
                       tone: .info, systemImage: "lock.shield")
        }
        .refreshable { await load() }
        .task { if case .idle = state { await load() } }
    }

    private var allStoresRow: some View {
        Button {
            choose(nil)
        } label: {
            HStack {
                Image(systemName: "square.grid.2x2").foregroundStyle(Color.rgPrimary).accessibilityHidden(true)
                Text(L("All assigned stores")).font(.headline).foregroundStyle(Color.rgInk)
                Spacer()
                if appState.selectedStoreId == nil {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.rgPrimary)
                        .accessibilityHidden(true)
                }
            }
            .rgTapTarget()
            .rgCard()
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(appState.selectedStoreId == nil ? .isSelected : [])
    }

    private func storeRow(_ store: Store) -> some View {
        Button {
            choose(store.id)
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(store.name).font(.headline).foregroundStyle(Color.rgInk)
                    Spacer()
                    if appState.selectedStoreId == store.id {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.rgPrimary)
                            .accessibilityHidden(true)
                    }
                }
                if let region = store.region { Text(region).font(.subheadline).foregroundStyle(Color.rgSecondaryText) }
                HStack(spacing: 8) {
                    StatusBadge(text: LF("%@/%@ cameras ready", String(store.camerasReady), String(store.cameraCount)),
                                systemImage: "video", tone: store.camerasReady == store.cameraCount && store.cameraCount > 0 ? .success : .warning)
                    StatusBadge(text: LF("%@ open alerts", String(store.openAlerts)), systemImage: "bell",
                                tone: store.openAlerts > 0 ? .warning : .neutral)
                    edgeBadge(store.edgeState)
                }
            }
            .rgCard()
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(appState.selectedStoreId == store.id ? .isSelected : [])
    }

    private func edgeBadge(_ state: EdgeState) -> StatusBadge {
        switch state {
        case .online: return StatusBadge(text: L("Appliance online"), systemImage: "server.rack", tone: .success)
        case .offline: return StatusBadge(text: L("Appliance offline"), systemImage: "server.rack", tone: .critical)
        case .unpaired: return StatusBadge(text: L("No appliance"), systemImage: "server.rack", tone: .neutral)
        case .revoked, .unrecognized: return StatusBadge(text: L("Appliance unavailable"), systemImage: "server.rack", tone: .neutral)
        }
    }

    private func choose(_ id: String?) {
        appState.selectStore(id)
        if !isOnboarding { dismiss() }
    }

    private func load() async {
        state = .loading
        do {
            let page = try await appState.api.stores()
            nextCursor = page.nextCursor
            state = .loaded(page.items)
        } catch {
            state = .failed(appState.present(error))
        }
    }

    private func loadMore() async {
        guard let cursor = nextCursor, case .loaded(let existing) = state else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let page = try await appState.api.stores(cursor: cursor)
            nextCursor = page.nextCursor
            state = .loaded(existing + page.items)
        } catch {
            _ = appState.present(error)
        }
    }
}
