import Foundation
import SwiftUI
import UIKit
import RetailGuardCore

/// In-memory only cache for authorized thumbnails/snapshots (`GET
/// /v1/media/{id}`). Media responses are `Cache-Control: private, no-store`,
/// so nothing is written to disk; the cache is purged on sign-out and memory
/// warnings.
@MainActor
final class MediaImageCache {
    static let shared = MediaImageCache()
    private let cache = NSCache<NSString, UIImage>()

    init() {
        cache.countLimit = 120
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.cache.removeAllObjects() }
        }
    }

    func image(for key: String) -> UIImage? { cache.object(forKey: key as NSString) }
    func store(_ image: UIImage, for key: String) { cache.setObject(image, forKey: key as NSString) }
    func removeAll() { cache.removeAllObjects() }
}

/// Temporary, file-protected storage for evidence clips while they are being
/// played. Files are deleted when the player is dismissed and the whole
/// directory is purged at launch and sign-out.
enum EvidenceFileStore {
    static var directory: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("rg-evidence", isDirectory: true)
    }

    static func makeDestination(fileExtension: String) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.protectionKey: FileProtectionType.complete])
        return directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
    }

    static func protect(_ url: URL) {
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = url
        try? mutable.setResourceValues(values)
    }

    static func delete(_ url: URL?) {
        guard let url else { return }
        try? FileManager.default.removeItem(at: url)
    }

    static func purgeAll() {
        try? FileManager.default.removeItem(at: directory)
    }
}

/// Image fetched through the authenticated media endpoint.
struct AuthenticatedImage: View {
    @Environment(AppState.self) private var appState
    let mediaId: String?
    var thumbnail: Bool = true
    var contentMode: ContentMode = .fill
    var imageLabel: String

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            Rectangle().fill(Color.rgSurfaceMuted)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .accessibilityLabel(imageLabel)
            } else if failed || mediaId == nil {
                VStack(spacing: 4) {
                    Image(systemName: "photo.badge.exclamationmark")
                        .font(.title3)
                    Text(L("Image unavailable"))
                        .font(.caption2)
                        .multilineTextAlignment(.center)
                }
                .foregroundStyle(Color.rgSecondaryText)
                .padding(4)
                .accessibilityElement(children: .combine)
            } else {
                ProgressView()
                    .accessibilityLabel(L("Loading image"))
            }
        }
        .clipped()
        .task(id: mediaId) { await load() }
    }

    private func load() async {
        guard let mediaId else { return }
        let key = "\(mediaId)|\(thumbnail)"
        if let cached = MediaImageCache.shared.image(for: key) {
            image = cached
            return
        }
        do {
            let data = try await appState.api.mediaData(id: mediaId, thumbnail: thumbnail)
            if let decoded = UIImage(data: data) {
                MediaImageCache.shared.store(decoded, for: key)
                image = decoded
                failed = false
            } else {
                failed = true
            }
        } catch {
            _ = appState.present(error)
            failed = true
        }
    }
}
