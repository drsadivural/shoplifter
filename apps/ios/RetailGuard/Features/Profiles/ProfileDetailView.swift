import SwiftUI
import PhotosUI
import RetailGuardCore

/// ios-19 — Subject / staff profile: photos, evidence basis, scope, status,
/// visit candidates and audited lifecycle actions.
struct ProfileDetailView: View {
    @Environment(AppState.self) private var appState
    let profileId: String

    @State private var state: Loadable<Profile> = .idle
    @State private var pendingAction: ProfileAction?
    @State private var message: String?
    @State private var conflict: UserFacingError?
    @State private var photoItem: PhotosPickerItem?
    @State private var uploading = false
    @State private var uploadError: String?

    var body: some View {
        ScreenScaffold(title: titleText, subtitle: state.value?.reference) {
            LoadableView(state: state, retry: load) { profile in
                content(profile)
            }
        }
        .refreshable { await load() }
        .task { if case .idle = state { await load() } }
        .sheet(item: $pendingAction) { action in
            ReasonSheet(title: action.title, message: action.message, confirmTitle: action.title,
                        destructive: action.isDestructive) { reason in
                await perform(action, reason: reason)
            }
        }
        .onChange(of: photoItem) { _, item in
            Task { await uploadPicked(item) }
        }
    }

    private var titleText: String {
        state.value?.kind == .staff ? L("Staff profile") : L("Subject profile")
    }

    @ViewBuilder
    private func content(_ profile: Profile) -> some View {
        if let message { InfoBanner(text: message, tone: .success, systemImage: "checkmark.circle") }
        if let conflict {
            VStack(alignment: .leading, spacing: 8) {
                ErrorBanner(error: conflict)
                Button(L("Refresh")) { Task { self.conflict = nil; await load() } }.buttonStyle(.rgPrimary)
            }
            .rgCard()
        }

        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                profile.status.presentation.badge
                profile.galleryState.presentation.badge
            }
            KeyValueRow(label: profile.kind == .watchlist ? L("Reference ID") : L("Employee ID"), value: profile.reference)
            if profile.kind == .watchlist {
                KeyValueRow(label: L("Name"), value: (profile.displayName?.isEmpty == false) ? profile.displayName! : L("Not recorded"))
                KeyValueRow(label: L("Last seen"),
                            value: profile.lastSeenAt.map { appState.format($0, storeId: profile.storeIds.first, includeZone: true) }
                                ?? L("Not recorded"))
            } else if let name = profile.displayName, !name.isEmpty {
                KeyValueRow(label: L("Name"), value: name)
            }
            if profile.galleryState == .faceSDKUnavailable {
                FieldHint(text: L("Face templates are not created: the licensed face SDK is not installed. The profile cannot be matched until it is."))
            }
            KeyValueRow(label: L("Version"), value: String(profile.version))
        }
        .rgCard()

        photosSection(profile)

        // Older watchlist records may carry an evidence basis or linked incident; shown only when present.
        if profile.kind == .staff || profile.basis?.isEmpty == false || profile.sourceIncidentId != nil {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: profile.kind == .watchlist ? L("Evidence basis") : L("Photo notice"))
            if profile.kind == .watchlist {
                if let basis = profile.basis, !basis.isEmpty { Text(basis).font(.subheadline) }
                if let source = profile.sourceIncidentId {
                    Button {
                        appState.open(.incident(source))
                    } label: {
                        Label(L("Supporting incident"), systemImage: "doc.text.magnifyingglass")
                    }
                    .buttonStyle(.rgSecondary)
                }
            } else {
                KeyValueRow(label: L("Notice recorded"), value: profile.noticeRecorded == true ? L("Yes") : L("No"),
                            valueTone: profile.noticeRecorded == true ? .success : .warning)
                if let role = profile.roleContext { KeyValueRow(label: L("Role"), value: role) }
            }
        }
        .rgCard()
        }

        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Scope"))
            KeyValueRow(label: L("Store scope"), value: storeNames(profile.storeIds))
            KeyValueRow(label: L("Expiry"), value: appState.format(profile.expiresAt, storeId: profile.storeIds.first, style: .date),
                        valueTone: (profile.expiresAt ?? .distantFuture) < Date() ? .critical : nil)
            if profile.kind == .watchlist, let reviewAt = profile.reviewAt {
                KeyValueRow(label: L("Review date"), value: appState.format(reviewAt, storeId: profile.storeIds.first, style: .date))
            }
            if let creator = profile.createdBy?.displayName { KeyValueRow(label: L("Created by"), value: creator) }
            if let approver = profile.approvedBy?.displayName { KeyValueRow(label: L("Approved by"), value: approver) }
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Visit candidates"))
            UnavailableStateView(title: L("Visit candidates unavailable"),
                                 message: L("Candidate visits need the licensed face SDK and cross-camera re-identification, which are not installed. Linked incidents below were associated by people, not by matching."))
            if let linked = profile.linkedIncidents, !linked.isEmpty {
                ForEach(linked) { item in
                    Button {
                        appState.open(.incident(item.id))
                    } label: {
                        HStack {
                            Label(item.ref ?? L("Incident"), systemImage: "link")
                            Spacer()
                            if let outcome = item.outcome { outcome.presentation.badge }
                        }
                        .rgTapTarget()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .rgCard()

        if let history = profile.history, !history.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                SectionTitle(text: L("Review history"))
                ForEach(Array(history.enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 2) {
                        Text([entry.action.map { $0.replacingOccurrences(of: "_", with: " ") }, entry.actor?.displayName]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.subheadline)
                        if let reason = entry.reason { Text(reason).font(.caption) }
                        if let at = entry.at {
                            Text(appState.format(at, storeId: profile.storeIds.first)).font(.caption)
                                .foregroundStyle(Color.rgSecondaryText)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .rgCard()
        }

        actionsSection(profile)
    }

    private func photosSection(_ profile: Profile) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: L("Reference photos"))
            let photos = (profile.photos ?? []).filter { $0.status != .deleted }
            if photos.isEmpty {
                Text(L("No photos yet.")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(photos) { photo in
                            Button {
                                appState.open(.photoQuality(profileId: profile.id, photoId: photo.id))
                            } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    AuthenticatedImage(mediaId: photo.thumbMediaId ?? photo.mediaId, thumbnail: true,
                                                       imageLabel: L("Reference photo"))
                                        .frame(width: 96, height: 120)
                                        .clipShape(RoundedRectangle(cornerRadius: 10))
                                    photo.status.presentation.badge
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint(L("Opens photo quality review"))
                        }
                    }
                }
            }
            if canManage(profile), profile.status != .deleted {
                if uploading { ProgressView(L("Uploading…")) }
                if let uploadError { FieldError(text: uploadError) }
                HStack {
                    Button {
                        appState.open(.photoCapture(profileId: profile.id))
                    } label: {
                        Label(L("Take photo"), systemImage: "camera")
                    }
                    .buttonStyle(.rgSecondary)
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label(L("Choose photo"), systemImage: "photo.on.rectangle")
                    }
                    .buttonStyle(.rgSecondary)
                }
                FieldHint(text: L("Photos are reviewed before use. Nothing is approved automatically."))
            }
        }
        .rgCard()
    }

    @ViewBuilder
    private func actionsSection(_ profile: Profile) -> some View {
        let actions = appState.userId.map { profile.availableActions(userId: $0, permissions: appState.permissions) } ?? []
        if !actions.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SectionTitle(text: L("Actions"))
                ForEach(actions, id: \.self) { action in
                    if action.isDestructive {
                        Button(action.title) { pendingAction = action }
                            .buttonStyle(.rgDestructive)
                    } else {
                        Button(action.title) { pendingAction = action }
                            .buttonStyle(.rgSecondaryWide)
                    }
                }
                if profile.kind == .watchlist, profile.status == .pendingReview {
                    FieldHint(text: L("Approval requires a supporting incident with a confirmed human outcome and at least one approved photo. The approver must differ from the creator."))
                }
                FieldHint(text: L("Every change is recorded in the audit log and propagated to store galleries."))
            }
            .rgCard()
        }
    }

    private func canManage(_ profile: Profile) -> Bool {
        appState.can(profile.kind == .watchlist ? .watchlistManage : .staffManage)
    }

    private func storeNames(_ ids: [String]) -> String {
        let names = ids.compactMap { appState.me?.store(id: $0)?.name }
        if names.isEmpty { return ids.isEmpty ? L("None") : LF("%@ stores", String(ids.count)) }
        return names.joined(separator: ", ")
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            state = .loaded(try await appState.api.profile(id: profileId))
        } catch {
            state = .failed(appState.present(error))
        }
    }

    private func perform(_ action: ProfileAction, reason: String) async -> UserFacingError? {
        guard let profile = state.value else { return nil }
        do {
            let updated = try await appState.api.profileAction(action, profileId: profile.id,
                                                               expectedVersion: profile.version, reason: reason)
            state = .loaded(updated)
            message = LF("%@: done.", action.title)
            if action == .delete { await load() }
            return nil
        } catch {
            let failure = appState.present(error)
            if case .conflict = failure.kind {
                conflict = failure
                await load()
            }
            return failure
        }
    }

    private func uploadPicked(_ item: PhotosPickerItem?) async {
        guard let item, let profile = state.value else { return }
        uploadError = nil
        uploading = true
        defer { uploading = false; photoItem = nil }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                uploadError = L("The photo could not be read.")
                return
            }
            let prepared = try PreparedPhoto.make(from: data)
            let photo = try await appState.api.uploadPhoto(profileId: profile.id, imageData: prepared.jpegData,
                                                           mimeType: "image/jpeg",
                                                           provenance: L("Selected from photo library on iOS"))
            await load()
            appState.open(.photoQuality(profileId: profile.id, photoId: photo.id))
        } catch let failure as ImageInspector.Failure {
            uploadError = PreparedPhoto.message(for: failure)
        } catch {
            uploadError = appState.present(error).message
        }
    }
}
