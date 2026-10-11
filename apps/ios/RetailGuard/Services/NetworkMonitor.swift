import Foundation
import Network
import Observation

/// Publishes coarse connectivity. Used to switch to the offline screen and to
/// re-arm "refresh before submit" on drafts when connectivity returns.
@MainActor
@Observable
final class NetworkMonitor {
    private(set) var isOnline = true
    private(set) var isExpensive = false
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.ayonix.retailguard.network")
    var onReconnect: (() -> Void)?

    func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            let expensive = path.isExpensive
            Task { @MainActor [weak self] in
                guard let self else { return }
                let wasOffline = !self.isOnline
                self.isOnline = online
                self.isExpensive = expensive
                if wasOffline && online { self.onReconnect?() }
            }
        }
        monitor.start(queue: queue)
    }

    /// Records a failed request that indicates the device is offline even if
    /// the path monitor has not caught up yet.
    func markOffline() {
        isOnline = false
    }

    func markOnline() {
        let wasOffline = !isOnline
        isOnline = true
        if wasOffline { onReconnect?() }
    }
}
