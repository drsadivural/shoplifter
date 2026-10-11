import SwiftUI
import RetailGuardCore

/// ios-26 — Cameras: privacy-masked snapshots with readiness, analysis state
/// and frame freshness. No RTSP addresses or credentials are shown.
struct CamerasView: View {
    @Environment(AppState.self) private var appState
    @State private var state: Loadable<[Camera]> = .idle

    var body: some View {
        ScreenScaffold(title: L("Cameras")) {
            if !appState.can(.cameraRead) {
                PermissionDeniedView()
            } else {
                LoadableView(state: state, retry: load) { cameras in
                    if cameras.isEmpty {
                        EmptyStateView(systemImage: "video.slash", title: L("No cameras"),
                                       message: L("No cameras are configured for this store. Administrators add cameras from the web console."))
                    } else {
                        let ready = cameras.filter { $0.readiness == .ready }.count
                        let analyzing = cameras.filter { $0.analysisState == .analyzing }.count
                        HStack(spacing: 12) {
                            MetricTile(title: L("Online status"), value: "\(ready)/\(cameras.count)", caption: L("Ready to stream"))
                            MetricTile(title: L("Analyzing"), value: "\(analyzing)/\(cameras.count)", caption: L("Analysis running"))
                        }
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
                            ForEach(cameras) { camera in
                                Button {
                                    appState.open(.camera(camera.id))
                                } label: {
                                    CameraTile(camera: camera)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            }
        }
        .refreshable { await load() }
        .task(id: appState.selectedStoreId) { await load() }
    }

    private func load() async {
        guard appState.can(.cameraRead) else { return }
        if state.value == nil { state = .loading }
        do {
            var all: [Camera] = []
            var cursor: String?
            repeat {
                let page = try await appState.api.cameras(storeId: appState.selectedStoreId, cursor: cursor)
                all += page.items
                cursor = page.nextCursor
            } while cursor != nil && all.count < 500
            state = .loaded(all)
        } catch {
            state = .failed(appState.present(error))
        }
    }
}

struct CameraTile: View {
    @Environment(AppState.self) private var appState
    let camera: Camera

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomLeading) {
                AuthenticatedImage(mediaId: camera.snapshot?.mediaId, thumbnail: true,
                                   imageLabel: LF("Latest snapshot from %@", camera.name))
                    .frame(height: 100)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                if camera.isFrameStale() {
                    StatusBadge(text: L("Stale frame"), systemImage: "clock.badge.exclamationmark", tone: .warning)
                        .padding(6)
                }
            }
            Text(camera.name).font(.subheadline.weight(.semibold)).foregroundStyle(Color.rgInk).lineLimit(2)
            if let location = camera.location { Text(location).font(.caption).foregroundStyle(Color.rgSecondaryText) }
            camera.readiness.presentation.badge
            camera.analysisState.presentation.badge
        }
        .rgCard(padding: 10)
        .accessibilityElement(children: .combine)
        .accessibilityHint(L("Opens camera preview"))
    }
}

/// ios-27 — Camera preview. Mobile live streaming is not provided by the API;
/// the latest privacy-masked snapshot is shown with its capture time, and can
/// be re-fetched.
struct CameraPreviewView: View {
    @Environment(AppState.self) private var appState
    let cameraId: String

    @State private var state: Loadable<Camera> = .idle
    @State private var privacyMasks: Int?

    var body: some View {
        ScreenScaffold(title: L("Camera preview"), subtitle: state.value?.name) {
            LoadableView(state: state, retry: load) { camera in
                content(camera)
            }
        }
        .refreshable { await load() }
        .task { if case .idle = state { await load() } }
    }

    @ViewBuilder
    private func content(_ camera: Camera) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(L("Authorized live view")).font(.headline)
            InfoBanner(text: L("Live streaming is not available in the mobile app. Showing the latest privacy-masked snapshot from the store appliance."),
                       tone: .info, systemImage: "info.circle")
            AuthenticatedImage(mediaId: camera.snapshot?.mediaId, thumbnail: false, contentMode: .fit,
                               imageLabel: LF("Latest snapshot from %@", camera.name))
                .frame(minHeight: 200)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .id(camera.snapshot?.mediaId)
            if let snapshot = camera.snapshot {
                Text(LF("Snapshot captured %@", appState.format(snapshot.capturedAt, storeId: camera.storeId, style: .evidence, includeZone: true)))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Color.rgSecondaryText)
            } else {
                FieldHint(text: L("No snapshot has been received from this camera yet."))
            }
            Button {
                Task {
                    MediaImageCache.shared.removeAll()
                    await load()
                }
            } label: {
                Label(L("Refresh snapshot"), systemImage: "arrow.clockwise")
            }
            .buttonStyle(.rgSecondary)
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: L("Connection status"))
            HStack {
                camera.readiness.presentation.badge
                camera.analysisState.presentation.badge
            }
            KeyValueRow(label: L("Last frame"), value: appState.format(camera.lastFrameAt, storeId: camera.storeId, style: .timeWithSeconds),
                        valueTone: camera.isFrameStale() ? .warning : nil)
            if camera.isFrameStale() {
                FieldHint(text: L("No recent frame: the camera or store appliance may be offline."))
            }
            if let report = camera.readinessReport {
                if let width = report.width, let height = report.height {
                    KeyValueRow(label: L("Resolution"), value: "\(width) × \(height)")
                }
                if let fps = report.fps {
                    KeyValueRow(label: L("Frame rate"), value: fps.formatted(.number.precision(.fractionLength(0...1))) + " fps")
                }
                ForEach(report.errors, id: \.self) { item in
                    Label(item.replacingOccurrences(of: "_", with: " "), systemImage: "exclamationmark.triangle")
                        .font(.caption).foregroundStyle(Color.rgWarning)
                }
            }
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: L("Analysis status"))
            ForEach(camera.channels.keys.sorted(), id: \.self) { key in
                if let status = camera.channels[key] {
                    HStack {
                        Text(ChannelName.title(key)).font(.subheadline)
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            status.state.presentation.badge
                            if let reason = status.reason {
                                Text(ChannelName.reason(reason)).font(.caption2).foregroundStyle(Color.rgSecondaryText)
                            }
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            FieldHint(text: L("A camera is only analyzing when frames and the required models are healthy."))
        }
        .rgCard()

        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: L("Privacy mask"))
            if let privacyMasks {
                KeyValueRow(label: L("Privacy mask zones"), value: String(privacyMasks))
            }
            FieldHint(text: L("Privacy masks are applied on the store appliance before snapshots and evidence are stored."))
        }
        .rgCard()
    }

    private func load() async {
        if state.value == nil { state = .loading }
        do {
            let camera = try await appState.api.camera(id: cameraId)
            state = .loaded(camera)
            if let zones = try? await appState.api.zones(cameraId: cameraId) {
                privacyMasks = zones.zones.filter { $0.type == .privacyMask }.count
            }
        } catch {
            state = .failed(appState.present(error))
        }
    }
}
