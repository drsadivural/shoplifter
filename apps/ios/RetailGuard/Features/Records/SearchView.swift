import SwiftUI
import PhotosUI
import UIKit
import RetailGuardCore

/// ios-16 — Search records by date/store/type/outcome, optionally with a
/// temporary reference photo. Photo search returns 503 `face_sdk_unavailable`
/// while the licensed SDK is absent; that is shown explicitly.
struct SearchView: View {
    @Environment(AppState.self) private var appState
    @State private var firstDay = Calendar.current.date(byAdding: .day, value: -6, to: Date()) ?? Date()
    @State private var lastDay = Date()
    @State private var storeId: String?
    @State private var channel: IncidentChannel?
    @State private var outcome: Outcome?
    @State private var evidenceState: EvidenceState?
    @State private var photoItem: PhotosPickerItem?
    @State private var photo: PreparedPhoto?
    @State private var photoError: String?
    @State private var busy = false
    @State private var photoSearchUnavailable: UserFacingError?
    @State private var initialized = false

    var body: some View {
        ScreenScaffold(title: L("Search records")) {
            if !appState.can(.searchMetadata) {
                PermissionDeniedView()
            } else {
                criteria
                if appState.can(.searchPhoto) { photoSection }
                if let photoSearchUnavailable {
                    UnavailableStateView(title: L("Photo search unavailable"), message: photoSearchUnavailable.message)
                }
                Button {
                    Task { await search() }
                } label: {
                    HStack {
                        if busy { ProgressView().tint(Color.rgOnPrimary) }
                        Text(L("Search"))
                    }
                }
                .buttonStyle(.rgPrimaryWide)
                .disabled(busy)
                FieldHint(text: L("Results reflect retained records and camera coverage only. Gaps are listed with each search."))
            }
        }
        .onAppear {
            if !initialized {
                storeId = appState.selectedStoreId
                initialized = true
            }
        }
        .onChange(of: photoItem) { _, item in
            Task { await preparePhoto(item) }
        }
    }

    private var storeTime: StoreTime { appState.storeTime(for: storeId) }

    private var criteria: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("Date range")).font(.subheadline.weight(.semibold))
            DatePicker(L("From"), selection: $firstDay, in: ...lastDay, displayedComponents: .date)
            DatePicker(L("To"), selection: $lastDay, in: firstDay...Date(), displayedComponents: .date)
            FieldHint(text: LF("Dates use store time (%@).", storeTime.timeZone.identifier))
            Divider()
            Picker(L("Store"), selection: $storeId) {
                Text(L("All assigned stores")).tag(String?.none)
                ForEach(appState.me?.stores ?? []) { store in
                    Text(store.name).tag(String?.some(store.id))
                }
            }
            Picker(L("Type"), selection: $channel) {
                Text(L("Any type")).tag(IncidentChannel?.none)
                ForEach(IncidentChannel.allCases.filter { $0 != .unrecognized }, id: \.self) {
                    Text($0.title).tag(IncidentChannel?.some($0))
                }
            }
            Picker(L("Outcome"), selection: $outcome) {
                Text(L("Any outcome")).tag(Outcome?.none)
                ForEach(Outcome.selectable, id: \.self) { Text($0.title).tag(Outcome?.some($0)) }
            }
            Picker(L("Evidence availability"), selection: $evidenceState) {
                Text(L("Any")).tag(EvidenceState?.none)
                ForEach([EvidenceState.available, .pending, .unavailable, .expired], id: \.self) {
                    Text($0.presentation.text).tag(EvidenceState?.some($0))
                }
            }
        }
        .environment(\.timeZone, storeTime.timeZone)
        .rgCard()
    }

    private var photoSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("Reference photo")).font(.subheadline.weight(.semibold))
            Text(L("Optional. The photo is checked for quality, used for this search only and deleted by the server immediately. Results are candidates that require review."))
                .font(.caption).foregroundStyle(Color.rgSecondaryText)
            if let photo {
                HStack(spacing: 12) {
                    Image(uiImage: photo.preview)
                        .resizable().scaledToFill()
                        .frame(width: 72, height: 72)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .accessibilityLabel(L("Selected reference photo"))
                    VStack(alignment: .leading) {
                        Text(verbatim: "\(photo.info.width)×\(photo.info.height)").font(.caption.monospacedDigit())
                        Button(L("Remove photo"), role: .destructive) {
                            self.photo = nil
                            photoItem = nil
                            photoSearchUnavailable = nil
                        }
                        .rgTapTarget()
                    }
                }
            }
            if let photoError { FieldError(text: photoError) }
            PhotosPicker(selection: $photoItem, matching: .images, photoLibrary: .shared()) {
                Label(photo == nil ? L("Choose photo") : L("Choose another photo"), systemImage: "photo.on.rectangle")
            }
            .buttonStyle(.rgSecondary)
        }
        .rgCard()
    }

    private func preparePhoto(_ item: PhotosPickerItem?) async {
        photoError = nil
        guard let item else { return }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                photoError = L("The photo could not be read.")
                return
            }
            photo = try PreparedPhoto.make(from: data)
        } catch let failure as ImageInspector.Failure {
            photoError = PreparedPhoto.message(for: failure)
            photo = nil
        } catch {
            photoError = L("The photo could not be read.")
            photo = nil
        }
    }

    private func buildRequest() -> SearchRequest {
        let range = storeTime.queryRange(firstDay: firstDay, lastDay: lastDay)
        let query = IncidentQuery(storeId: storeId, channel: channel, outcome: outcome,
                                  from: RFC3339.parse(range.from), to: RFC3339.parse(range.to),
                                  evidenceState: evidenceState, limit: 50)
        return SearchRequest(query: query, firstDay: firstDay, lastDay: lastDay)
    }

    private func search() async {
        photoSearchUnavailable = nil
        let request = buildRequest()
        if let photo, appState.can(.searchPhoto) {
            busy = true
            defer { busy = false }
            do {
                let response = try await appState.api.photoSearch(imageData: photo.jpegData, mimeType: "image/jpeg")
                // Ranked candidates (server order) — shown as candidates that
                // require review, never as matches.
                appState.photoSearchResults = response
                var photoRequest = request
                photoRequest.isPhotoSearch = true
                appState.open(.searchResults(photoRequest), in: .search)
            } catch {
                let failure = appState.present(error)
                if case .unavailable = failure.kind {
                    photoSearchUnavailable = failure
                } else if case .validation = failure.kind {
                    photoError = failure.message
                } else {
                    photoSearchUnavailable = failure
                }
            }
            // The query photo is not retained on the device after the request.
            self.photo = nil
            photoItem = nil
            return
        }
        appState.open(.searchResults(request), in: .search)
    }
}

/// Reference/query photo normalized to JPEG and pre-validated against the
/// upload contract. Face quality is not assessed on device.
struct PreparedPhoto {
    let jpegData: Data
    let info: ImageInspector.Info
    let preview: UIImage

    static func make(from data: Data, maxDimension: CGFloat = 3000) throws -> PreparedPhoto {
        guard let image = UIImage(data: data) else { throw ImageInspector.Failure.unsupportedFormat }
        let normalized = image.normalizedForUpload(maxDimension: maxDimension)
        guard let jpeg = normalized.jpegData(compressionQuality: 0.88) else { throw ImageInspector.Failure.unsupportedFormat }
        let info = try ImageInspector.validateForUpload(jpeg)
        return PreparedPhoto(jpegData: jpeg, info: info, preview: normalized)
    }

    static func message(for failure: ImageInspector.Failure) -> String {
        switch failure {
        case .unsupportedFormat: return L("Unsupported file type. Use a JPEG or PNG photo.")
        case .unreadableDimensions: return L("The photo could not be read.")
        case .tooLarge: return L("The file is too large. Photos must be 8 MB or smaller.")
        case .tooSmall: return L("The photo is too small. Use at least 200 × 200 pixels.")
        case .tooManyPixels: return L("The photo has too many pixels (over 40 MP).")
        }
    }
}

extension UIImage {
    /// Applies orientation and caps the longest side. Re-encoding also drops
    /// EXIF/location metadata before upload.
    func normalizedForUpload(maxDimension: CGFloat) -> UIImage {
        let longest = max(size.width, size.height)
        let scale = longest > maxDimension ? maxDimension / longest : 1
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: target))
        }
    }
}
