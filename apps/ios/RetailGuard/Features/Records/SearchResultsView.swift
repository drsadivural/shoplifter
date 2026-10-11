import SwiftUI
import RetailGuardCore

/// ios-17 — Search results with retention/coverage gaps. Photo-search
/// candidates are ranked by the server; rank is an ordering, not a probability,
/// and every candidate requires human review.
struct SearchResultsView: View {
    @Environment(AppState.self) private var appState
    let request: SearchRequest

    @State private var state: Loadable<[IncidentSummary]> = .idle
    @State private var coverage: SearchCoverage?
    @State private var nextCursor: String?
    @State private var loadingMore = false

    var body: some View {
        ScreenScaffold(title: L("Search results"), subtitle: summaryText) {
            if let coverage { coverageCard(coverage) }
            LoadableView(state: state, retry: load) { items in
                if items.isEmpty {
                    EmptyStateView(systemImage: "magnifyingglass",
                                   title: L("No matching records"),
                                   message: L("Nothing matched in the retained, covered period. Check the coverage gaps above."))
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        if request.isPhotoSearch {
                            InfoBanner(text: L("Candidates are ordered by the face SDK's similarity ranking. Rank is not a probability or an identification; review the evidence before acting."),
                                       tone: .warning)
                                .padding(.bottom, 8)
                        } else {
                            FieldHint(text: L("Metadata search: results are ordered by time. Similarity rank applies only to photo search."))
                                .padding(.bottom, 8)
                        }
                        ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                            resultRow(item, rank: request.isPhotoSearch ? index + 1 : nil)
                            Divider()
                        }
                        if nextCursor != nil, !request.isPhotoSearch {
                            LoadMoreButton(isLoading: loadingMore) { await loadMore() }
                                .padding(.top, 8)
                        }
                    }
                    .rgCard()
                }
            }
        }
        .refreshable { if !request.isPhotoSearch { await load() } }
        .task { if case .idle = state { await load() } }
    }

    private var summaryText: String {
        let time = appState.storeTime(for: request.query.storeId)
        let from = time.format(request.firstDay, style: .date, locale: Localizer.locale)
        let to = time.format(request.lastDay, style: .date, locale: Localizer.locale)
        let store = appState.me?.store(id: request.query.storeId)?.name ?? L("All assigned stores")
        return "\(from) – \(to) · \(store)"
    }

    private func resultRow(_ item: IncidentSummary, rank: Int?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: item.channel.systemImage)
                .font(.title3)
                .foregroundStyle(Color.rgPrimary)
                .frame(width: 44, height: 44)
                .background(Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(item.ref).font(.headline)
                    if let rank {
                        StatusBadge(text: LF("Similarity rank %@", String(rank)), systemImage: "list.number", tone: .info)
                    }
                }
                Text(appState.format(item.capturedAt, storeId: item.storeId, style: .dateTime, includeZone: true))
                    .font(.subheadline)
                Text([item.cameraName, item.storeName, item.channel.title].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Color.rgSecondaryText)
                HStack(spacing: 6) {
                    item.evidenceState.presentation.badge
                    if let outcome = item.outcome { outcome.presentation.badge }
                }
                Button {
                    appState.open(.alertDetail(item.id), in: .search)
                } label: {
                    Label(L("Open evidence"), systemImage: "film")
                }
                .buttonStyle(.rgSecondary)
            }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .contain)
    }

    private func coverageCard(_ coverage: SearchCoverage) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Evidence availability"))
            if let cutoff = coverage.retentionCutoff {
                KeyValueRow(label: L("Retained since"), value: appState.format(cutoff, storeId: request.query.storeId, style: .dateTime))
            }
            KeyValueRow(label: L("Cameras covered"), value: String(coverage.cameras.count))
            if coverage.gaps.isEmpty {
                Label(L("No coverage gaps in this range."), systemImage: "checkmark.circle")
                    .font(.subheadline).foregroundStyle(Color.rgSuccess)
            } else {
                Text(LF("%@ coverage gap(s): results cannot include these periods.", String(coverage.gaps.count)))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.rgWarning)
                ForEach(Array(coverage.gaps.prefix(8).enumerated()), id: \.offset) { _, gap in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(gap.reason.title).font(.subheadline)
                        Text([gap.cameraId.flatMap { id in coverage.cameras.first { $0.id == id }?.name },
                              "\(appState.format(gap.from, storeId: request.query.storeId)) – \(appState.format(gap.to, storeId: request.query.storeId))"]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Color.rgSecondaryText)
                    }
                    .accessibilityElement(children: .combine)
                }
                if coverage.gaps.count > 8 {
                    FieldHint(text: LF("And %@ more.", String(coverage.gaps.count - 8)))
                }
            }
        }
        .rgCard()
    }

    private func load() async {
        if request.isPhotoSearch {
            if let response = appState.photoSearchResults {
                coverage = response.coverage
                state = .loaded(response.items)
            } else {
                state = .failed(UserFacingError(kind: .notFound, message: L("Photo search results are no longer available. Run the search again."), requestId: nil))
            }
            return
        }
        state = .loading
        do {
            let response = try await appState.api.search(request.query)
            coverage = response.coverage
            nextCursor = response.nextCursor
            state = .loaded(response.items)
        } catch {
            state = .failed(appState.present(error))
        }
    }

    private func loadMore() async {
        guard let cursor = nextCursor, case .loaded(let existing) = state else { return }
        loadingMore = true
        defer { loadingMore = false }
        do {
            let response = try await appState.api.search(request.query, cursor: cursor)
            nextCursor = response.nextCursor
            state = .loaded(existing + response.items)
        } catch {
            _ = appState.present(error)
        }
    }
}
