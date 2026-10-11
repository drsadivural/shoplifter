import SwiftUI
import RetailGuardCore

/// ios-24 — Review photo quality: authorized image, server quality metrics,
/// provenance and status; approve/reject with reason, delete by policy.
/// Face count/pose need the licensed face SDK and are shown as unavailable.
struct PhotoQualityView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let profileId: String
    let photoId: String

    @State private var state: Loadable<(Profile, Photo)> = .idle
    @State private var decision: Decision?
    @State private var confirmDelete = false
    @State private var message: String?
    @State private var error: UserFacingError?

    enum Decision: String, Identifiable {
        case approve, reject
        var id: String { rawValue }
    }

    var body: some View {
        ScreenScaffold(title: L("Review photo quality"), showsStoreSubtitle: false) {
            LoadableView(state: state, retry: load) { pair in
                content(profile: pair.0, photo: pair.1)
            }
        }
        .refreshable { await load() }
        .task { if case .idle = state { await load() } }
        .sheet(item: $decision) { decision in
            ReasonSheet(title: decision == .approve ? L("Approve photo") : L("Reject photo"),
                        message: decision == .approve
                            ? L("Approve only if the face is clearly visible, the photo is lawful to use and the provenance is recorded.")
                            : L("The photo will not be used for matching."),
                        confirmTitle: decision == .approve ? L("Approve photo") : L("Reject photo"),
                        destructive: decision == .reject) { reason in
                await review(approve: decision == .approve, reason: reason)
            }
        }
        .confirmationDialog(L("Delete this photo?"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(L("Delete photo"), role: .destructive) { Task { await delete() } }
        } message: {
            Text(L("The image and any face templates derived from it are deleted. This is recorded in the audit log."))
        }
    }

    @ViewBuilder
    private func content(profile: Profile, photo: Photo) -> some View {
        if let message { InfoBanner(text: message, tone: .success, systemImage: "checkmark.circle") }
        if let error { ErrorBanner(error: error) }

        VStack(alignment: .leading, spacing: 8) {
            AuthenticatedImage(mediaId: photo.mediaId, thumbnail: false, contentMode: .fit,
                               imageLabel: L("Reference photo"))
                .frame(maxHeight: 360)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            HStack {
                photo.status.presentation.badge
                Spacer()
                Text(profile.reference).font(.caption).foregroundStyle(Color.rgSecondaryText)
            }
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: L("Photo quality"))
            let face = photo.quality?.face
            let faceUnavailable = face == nil || face?.isAvailable == false
            KeyValueRow(label: L("Face count"),
                        value: faceUnavailable ? L("Unavailable") : (face?.faceCount.map(String.init) ?? "—"),
                        valueTone: faceUnavailable ? .warning : nil)
            KeyValueRow(label: L("Sharpness"), value: metric(photo.quality?.image?.sharpness))
            KeyValueRow(label: L("Exposure"), value: metric(photo.quality?.image?.brightness))
            KeyValueRow(label: L("Pose"), value: faceUnavailable ? L("Unavailable") : (face?.pose ?? "—"),
                        valueTone: faceUnavailable ? .warning : nil)
            KeyValueRow(label: L("Resolution"), value: resolution(photo))
            if faceUnavailable {
                FieldHint(text: L("Face count and pose require the licensed face SDK, which is not installed. Check the face manually before approving."))
            }
            FieldHint(text: L("Sharpness and exposure are raw image measurements from the server, not pass/fail scores."))
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: L("Provenance"))
            Text(photo.provenance ?? L("Not recorded")).font(.subheadline)
            KeyValueRow(label: L("Upload date"), value: appState.format(photo.createdAt, storeId: profile.storeIds.first))
        }
        .rgCard()

        let canReview = photo.status == .pending
            && appState.can(profile.kind == .watchlist ? .watchlistApprove : .staffManage)
        let canDelete = photo.status != .deleted
            && appState.can(profile.kind == .watchlist ? .watchlistManage : .staffManage)
        if canReview || canDelete {
            VStack(alignment: .leading, spacing: 8) {
                if canReview {
                    Button(L("Approve photo")) { decision = .approve }
                        .buttonStyle(.rgPrimaryWide)
                    Button(L("Reject photo")) { decision = .reject }
                        .buttonStyle(.rgSecondaryWide)
                }
                if canDelete {
                    Button(L("Delete photo"), role: .destructive) { confirmDelete = true }
                        .buttonStyle(.rgDestructive)
                }
            }
            .rgCard()
        } else if photo.status == .pending {
            FieldHint(text: L("A reviewer with approval permission must review this photo."))
        }
        Button {
            appState.open(.profile(profile.id))
        } label: {
            Label(L("Open profile"), systemImage: "person.crop.square")
        }
        .buttonStyle(.rgSecondaryWide)
    }

    private func metric(_ value: Double?) -> String {
        guard let value else { return L("Unavailable") }
        return value.formatted(.number.precision(.fractionLength(1)))
    }

    private func resolution(_ photo: Photo) -> String {
        let width = photo.width ?? photo.quality?.image?.width
        let height = photo.height ?? photo.quality?.image?.height
        guard let width, let height else { return "—" }
        return "\(width) × \(height)"
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let profile = try await appState.api.profile(id: profileId)
            guard let photo = profile.photos?.first(where: { $0.id == photoId }) else {
                state = .failed(UserFacingError(kind: .notFound, message: L("This photo is no longer available."), requestId: nil))
                return
            }
            state = .loaded((profile, photo))
        } catch {
            state = .failed(appState.present(error))
        }
    }

    private func review(approve: Bool, reason: String) async -> UserFacingError? {
        do {
            _ = try await appState.api.reviewPhoto(profileId: profileId, photoId: photoId, approve: approve, reason: reason)
            message = approve ? L("Photo approved.") : L("Photo rejected.")
            await load()
            return nil
        } catch {
            return appState.present(error)
        }
    }

    private func delete() async {
        do {
            try await appState.api.deletePhoto(profileId: profileId, photoId: photoId)
            MediaImageCache.shared.removeAll()
            dismiss()
        } catch {
            self.error = appState.present(error)
        }
    }
}
