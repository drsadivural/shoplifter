import SwiftUI
import RetailGuardCore

/// ios-15 — Past records: resolved incidents with server-side filters and
/// stable cursor pagination.
struct HistoryView: View {
    @Environment(AppState.self) private var appState
    @State private var state: Loadable<[IncidentSummary]> = .idle
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var firstDay = Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date()
    @State private var lastDay = Date()
    @State private var outcome: Outcome?
    @State private var channel: IncidentChannel?

    var body: some View {
        ScreenScaffold(title: L("Past records")) {
            if !appState.can(.incidentRead) {
                PermissionDeniedView()
            } else {
                filters
                LoadableView(state: state, retry: load) { items in
                    if items.isEmpty {
                        EmptyStateView(systemImage: "tray", title: L("No records in this range"),
                                       message: L("No resolved incidents match. Records outside the retention period are not available."))
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(items) { item in
                                Button {
                                    appState.open(.incident(item.id), in: .history)
                                } label: {
                                    historyRow(item)
                                }
                                .buttonStyle(.plain)
                                Divider()
                            }
                            if nextCursor != nil {
                                LoadMoreButton(isLoading: loadingMore) { await loadMore() }
                                    .padding(.top, 8)
                            }
                        }
                        .rgCard()
                    }
                }
            }
        }
        .refreshable { await load() }
        .task(id: reloadKey) { await load() }
    }

    private var reloadKey: String {
        "\(appState.selectedStoreId ?? "all")|\(firstDay.timeIntervalSince1970)|\(lastDay.timeIntervalSince1970)|\(outcome?.rawValue ?? "")|\(channel?.rawValue ?? "")"
    }

    private var filters: some View {
        let storeTime = appState.storeTime(for: appState.selectedStoreId)
        return VStack(alignment: .leading, spacing: 8) {
            DatePicker(L("From"), selection: $firstDay, in: ...lastDay, displayedComponents: .date)
            DatePicker(L("To"), selection: $lastDay, in: firstDay...Date(), displayedComponents: .date)
            HStack {
                Menu {
                    Picker(L("Outcome"), selection: $outcome) {
                        Text(L("Any outcome")).tag(Outcome?.none)
                        ForEach(Outcome.selectable, id: \.self) { Text($0.title).tag(Outcome?.some($0)) }
                    }
                } label: {
                    Label(outcome?.title ?? L("Any outcome"), systemImage: "checkmark.seal").rgTapTarget()
                }
                Spacer()
                Menu {
                    Picker(L("Event type"), selection: $channel) {
                        Text(L("Any type")).tag(IncidentChannel?.none)
                        ForEach(IncidentChannel.allCases.filter { $0 != .unrecognized }, id: \.self) {
                            Text($0.title).tag(IncidentChannel?.some($0))
                        }
                    }
                } label: {
                    Label(channel?.title ?? L("Any type"), systemImage: "line.3.horizontal.decrease.circle").rgTapTarget()
                }
            }
            FieldHint(text: LF("Dates use store time (%@).", storeTime.timeZone.identifier))
        }
        .environment(\.timeZone, storeTime.timeZone)
        .rgCard()
    }

    private func historyRow(_ item: IncidentSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(item.ref).font(.headline)
                Spacer()
                if let outcome = item.outcome { outcome.presentation.badge } else { item.status.presentation.badge }
            }
            Text(appState.format(item.capturedAt, storeId: item.storeId, style: .dateTime))
                .font(.subheadline)
            Text([item.storeName, item.channel.title].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(Color.rgSecondaryText)
            if let reviewer = item.assignee?.displayName {
                Text(LF("Reviewer: %@", reviewer)).font(.caption).foregroundStyle(Color.rgSecondaryText)
            }
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var query: IncidentQuery {
        let range = appState.storeTime(for: appState.selectedStoreId).queryRange(firstDay: firstDay, lastDay: lastDay)
        return IncidentQuery(storeId: appState.selectedStoreId, channel: channel, status: .resolved, outcome: outcome,
                             from: RFC3339.parse(range.from), to: RFC3339.parse(range.to), limit: 50)
    }

    private func load() async {
        guard appState.can(.incidentRead) else { return }
        state = .loading
        do {
            let page = try await appState.api.incidents(query)
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
            let page = try await appState.api.incidents(query, cursor: cursor)
            nextCursor = page.nextCursor
            state = .loaded(existing + page.items)
        } catch {
            _ = appState.present(error)
        }
    }
}
