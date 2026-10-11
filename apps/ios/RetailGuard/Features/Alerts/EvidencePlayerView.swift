import SwiftUI
import UIKit
import AVKit
import Combine
import RetailGuardCore

/// ios-10 — Evidence player. The clip is fetched with the bearer token from
/// `GET /v1/media/{id}` into a file-protected temporary file (AVPlayer cannot
/// send our Authorization header itself) and deleted when the player closes.
struct EvidencePlayerView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    let incident: IncidentSummary
    let evidence: EvidenceItem

    @State private var phase: Phase = .downloading
    @State private var fileURL: URL?
    @State private var player: AVPlayer?
    @State private var rate: Float = 1
    @State private var fullScreen = false
    @State private var duration: Double?
    @State private var itemFailed = false

    enum Phase: Equatable {
        case downloading
        case ready
        case failed(UserFacingError)
    }

    private static let rates: [Float] = [0.5, 1, 1.5, 2]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    ScreenHeader(title: L("Evidence player"),
                                 subtitle: [incident.ref, incident.cameraName].compactMap { $0 }.joined(separator: " · "))
                    playerArea
                    if phase == .ready, evidence.isVideo { controls }
                    timing
                    HumanReviewNotice()
                }
                .padding(RGMetrics.gutter)
            }
            .background(Color.rgBackground.ignoresSafeArea())
            .navigationTitle(L("Evidence player"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Close")) { dismiss() }
                }
            }
        }
        // Full screen is an in-place layer (not a nested presentation) so the
        // player and its temporary file stay alive while toggling.
        .overlay {
            if fullScreen, let player {
                ZStack(alignment: .topTrailing) {
                    Color.black.ignoresSafeArea()
                    VideoPlayer(player: player).ignoresSafeArea()
                    Button {
                        fullScreen = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(.white)
                            .rgTapTarget()
                    }
                    .accessibilityLabel(L("Exit full screen"))
                    .padding()
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AVPlayerItem.failedToPlayToEndTimeNotification)) { note in
            if let item = note.object as? AVPlayerItem, item === player?.currentItem { itemFailed = true }
        }
        .task { await download() }
        .onDisappear { cleanUp() }
    }

    @ViewBuilder private var playerArea: some View {
        switch phase {
        case .downloading:
            VStack(spacing: 8) {
                ProgressView()
                Text(L("Downloading evidence securely…")).font(.subheadline).foregroundStyle(Color.rgSecondaryText)
            }
            .frame(maxWidth: .infinity, minHeight: 220)
            .rgCard()
        case .failed(let error):
            FailureStateView(error: error) { await download() }
        case .ready:
            if evidence.isVideo, let player {
                if !fullScreen {
                    VideoPlayer(player: player)
                        .frame(minHeight: 220)
                        .aspectRatio(16 / 9, contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .accessibilityLabel(L("Evidence clip"))
                }
                if itemFailed {
                    InfoBanner(text: L("Playback stopped. The secure copy may have expired; download it again."), tone: .warning)
                    Button(L("Download again")) { Task { await download() } }
                        .buttonStyle(.rgSecondary)
                }
            } else if let fileURL, let image = UIImage(contentsOfFile: fileURL.path) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel(L("Evidence frame"))
            } else {
                StateMessageView(systemImage: "film.stack", title: L("Not available"),
                                 message: L("This evidence file could not be displayed."), tone: .warning)
            }
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Button {
                    seek(by: -5)
                } label: {
                    Image(systemName: "gobackward.5").rgTapTarget()
                }
                .accessibilityLabel(L("Back 5 seconds"))
                Button {
                    seek(by: 5)
                } label: {
                    Image(systemName: "goforward.5").rgTapTarget()
                }
                .accessibilityLabel(L("Forward 5 seconds"))
                Spacer()
                Menu {
                    Picker(L("Playback speed"), selection: $rate) {
                        ForEach(Self.rates, id: \.self) { value in
                            Text(Double(value).formatted(.number.precision(.fractionLength(0...1))) + "×").tag(value)
                        }
                    }
                } label: {
                    Label(LF("Playback speed %@×", Double(rate).formatted(.number.precision(.fractionLength(0...1)))), systemImage: "speedometer")
                        .rgTapTarget()
                }
                Button {
                    fullScreen = true
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right").rgTapTarget()
                }
                .accessibilityLabel(L("Full screen"))
            }
        }
        .rgCard()
        .onChange(of: rate) { _, newRate in
            player?.defaultRate = newRate
            if let player, player.timeControlStatus == .playing { player.rate = newRate }
        }
    }

    private var timing: some View {
        VStack(alignment: .leading, spacing: 4) {
            KeyValueRow(label: L("Trigger marker"),
                        value: appState.format(incident.capturedAt, storeId: incident.storeId, style: .evidence, includeZone: true))
            if let duration {
                KeyValueRow(label: L("Clip length"), value: Duration.seconds(duration).formatted(.time(pattern: .minuteSecond)))
            }
            FieldHint(text: L("Before trigger / After trigger: the clip covers the moments around the trigger time. The server does not report the exact trigger offset within the clip, so no marker is drawn on the timeline."))
            if let sha = evidence.sha256 {
                KeyValueRow(label: L("Content hash (SHA-256)"), value: String(sha.prefix(16)) + "…")
            }
        }
        .rgCard()
    }

    private func seek(by seconds: Double) {
        guard let player else { return }
        let target = CMTimeAdd(player.currentTime(), CMTime(seconds: seconds, preferredTimescale: 600))
        player.seek(to: CMTimeMaximum(target, .zero), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func download() async {
        cleanUp()
        phase = .downloading
        itemFailed = false
        do {
            let destination = try EvidenceFileStore.makeDestination(fileExtension: evidence.fileExtension)
            try await appState.api.downloadMedia(id: evidence.mediaId, to: destination)
            EvidenceFileStore.protect(destination)
            fileURL = destination
            if evidence.isVideo {
                let asset = AVURLAsset(url: destination)
                let item = AVPlayerItem(asset: asset)
                let newPlayer = AVPlayer(playerItem: item)
                newPlayer.defaultRate = rate
                player = newPlayer
                if let loaded = try? await asset.load(.duration), loaded.isNumeric {
                    duration = loaded.seconds
                }
            }
            phase = .ready
        } catch {
            phase = .failed(appState.present(error))
        }
    }

    private func cleanUp() {
        player?.pause()
        player = nil
        EvidenceFileStore.delete(fileURL)
        fileURL = nil
    }
}
