import Foundation
import RetailGuardCore

/// Build-time configuration read from Info.plist (populated from the
/// xcconfig files in `Config/`). No secrets live here.
struct AppConfig {
    /// Default API origin for this build configuration (`RG_API_BASE_URL`).
    let defaultBaseURL: URL?
    /// `sandbox` for Debug, `production` for Release (`RG_APNS_ENVIRONMENT`).
    let apnsEnvironment: APNsEnvironment
    /// Debug builds may point at a loopback API over plain HTTP.
    let allowsInsecureLoopback: Bool
    /// Whether the workspace origin may be edited in the welcome screen.
    let allowsWorkspaceOverride: Bool
    let bundleIdentifier: String
    let appVersion: String
    let buildNumber: String

    static func load(from bundle: Bundle = .main) -> AppConfig {
        let info = bundle.infoDictionary ?? [:]
        func string(_ key: String) -> String? {
            guard let value = info[key] as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            // Unexpanded build settings mean the xcconfig was not applied.
            return trimmed.isEmpty || trimmed.hasPrefix("$(") ? nil : trimmed
        }
        func bool(_ key: String) -> Bool {
            if let value = info[key] as? Bool { return value }
            return ["yes", "true", "1"].contains(string(key)?.lowercased() ?? "")
        }
        let insecure = bool("RGAllowInsecureLoopback")
        let base = string("RGAPIBaseURL").flatMap {
            try? BaseURLPolicy.normalize($0, allowInsecureLoopback: insecure).get()
        }
        return AppConfig(
            defaultBaseURL: base,
            apnsEnvironment: APNsEnvironment(rawValue: string("RGAPNSEnvironment") ?? "") ?? .production,
            allowsInsecureLoopback: insecure,
            allowsWorkspaceOverride: bool("RGAllowWorkspaceOverride"),
            bundleIdentifier: bundle.bundleIdentifier ?? "com.ayonix.retailguard",
            appVersion: string("CFBundleShortVersionString") ?? "0",
            buildNumber: string("CFBundleVersion") ?? "0"
        )
    }

    var userAgent: String {
        "RetailGuard-iOS/\(appVersion) (\(buildNumber))"
    }
}
