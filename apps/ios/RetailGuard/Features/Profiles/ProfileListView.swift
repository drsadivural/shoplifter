import SwiftUI
import RetailGuardCore

/// ios-18 (watchlist) and ios-21 (staff): scoped, paginated profile lists.
/// Requires `profile.read`; the server never enumerates outside the user's scope.
struct ProfileListView: View {
    @Environment(AppState.self) private var appState
    let kind: ProfileKind

    @State private var state: Loadable<[Profile]> = .idle
    @State private var nextCursor: String?
    @State private var loadingMore = false
    @State private var status: ProfileStatus?
    @State private var text = ""
    @State private var initialized = false

    var body: some View {
        ScreenScaffold(title: kind == .watchlist ? L("title.watchlist") : L("Staff")) {
            if !appState.can(.profileRead) {
                PermissionDeniedView()
            } else {
                if kind == .watchlist {
                    InfoBanner(text: L("Enrolled subjects (登録対象者) are candidates for review only. A watchlist match is not proof of wrongdoing."),
                               tone: .warning, systemImage: "info.circle")
                } else {
                    InfoBanner(text: L("Staff recognition only annotates workflow context. It never exempts anyone from independently supported checkout exceptions."),
                               tone: .info, systemImage: "info.circle")
                }
                filterBar
                LoadableView(state: state, retry: load) { profiles in
                    if profiles.isEmpty {
                        EmptyStateView(systemImage: kind == .watchlist ? "person.crop.rectangle.stack" : "person.text.rectangle",
                                       title: L("No profiles"),
                                       message: L("No profiles match these filters in your assigned stores."))
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(profiles) { profile in
                                Button {
                                    appState.open(.profile(profile.id))
                                } label: {
                                    row(profile)
                                }
                                .buttonStyle(.plain)
                                Divider()
                            }
                            if nextCursor != nil {
                                LoadMoreButton(isLoading: loadingMore) { await loadMore() }.padding(.top, 8)
                            }
                        }
                        .rgCard()
                    }
                }
            }
        }
        .searchable(text: $text, prompt: kind == .watchlist ? L("Reference ID") : L("Employee ID or name"))
        .onSubmit(of: .search) { Task { await load() } }
        .refreshable { await load() }
        .toolbar {
            if canManage {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        appState.open(kind == .watchlist ? .subjectEnroll : .staffEnroll)
                    } label: {
                        Image(systemName: "plus").rgTapTarget()
                    }
                    .accessibilityLabel(kind == .watchlist ? L("Enroll subject") : L("Enroll staff"))
                }
            }
        }
        .onAppear {
            if !initialized {
                status = kind == .watchlist ? .approved : nil
                initialized = true
            }
        }
        .task(id: "\(status?.rawValue ?? "any")|\(appState.selectedStoreId ?? "all")|\(initialized)") {
            if initialized { await load() }
        }
    }

    private var canManage: Bool {
        appState.can(kind == .watchlist ? .watchlistManage : .staffManage)
    }

    private var filterBar: some View {
        Menu {
            Picker(L("Review status"), selection: $status) {
                Text(L("Any status")).tag(ProfileStatus?.none)
                ForEach([ProfileStatus.approved, .pendingReview, .draft, .suspended, .expired], id: \.self) {
                    Text($0.presentation.text).tag(ProfileStatus?.some($0))
                }
            }
        } label: {
            Label(LF("Status: %@", status?.presentation.text ?? L("Any status")), systemImage: "line.3.horizontal.decrease.circle")
                .font(.subheadline)
                .rgTapTarget()
        }
    }

    private func row(_ profile: Profile) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: kind == .watchlist ? "person.crop.square" : "person.text.rectangle")
                .font(.title2)
                .foregroundStyle(Color.rgPrimary)
                .frame(width: 44, height: 44)
                .background(Color.rgSurfaceMuted, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(profile.title).font(.headline)
                if kind == .staff, profile.displayName != nil {
                    Text(LF("Employee ID: %@", profile.reference)).font(.caption).foregroundStyle(Color.rgSecondaryText)
                }
                HStack(spacing: 6) {
                    profile.status.presentation.badge
                    if kind == .staff { profile.galleryState.presentation.badge }
                }
                Text(LF("%@ photos · %@ approved", String(profile.photoCount), String(profile.approvedPhotoCount)))
                    .font(.caption).foregroundStyle(Color.rgSecondaryText)
                if let expires = profile.expiresAt {
                    Text(LF("Expiry: %@", appState.format(expires, storeId: profile.storeIds.first, style: .date)))
                        .font(.caption)
                        .foregroundStyle(expires < Date() ? Color.rgCritical : Color.rgSecondaryText)
                }
                Text(LF("Assigned stores: %@", storeNames(profile.storeIds)))
                    .font(.caption).foregroundStyle(Color.rgSecondaryText)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(Color.rgSecondaryText).accessibilityHidden(true)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func storeNames(_ ids: [String]) -> String {
        let names = ids.compactMap { appState.me?.store(id: $0)?.name }
        if names.isEmpty { return ids.isEmpty ? L("None") : LF("%@ stores", String(ids.count)) }
        return names.joined(separator: ", ")
    }

    private func load() async {
        guard appState.can(.profileRead) else { return }
        state = .loading
        do {
            let page = try await appState.api.profiles(kind: kind, status: status, text: text, storeId: appState.selectedStoreId)
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
            let page = try await appState.api.profiles(kind: kind, status: status, text: text,
                                                       storeId: appState.selectedStoreId, cursor: cursor)
            nextCursor = page.nextCursor
            state = .loaded(existing + page.items)
        } catch {
            _ = appState.present(error)
        }
    }
}
