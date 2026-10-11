// swift-tools-version:5.10
// RetailGuardCore: Foundation-only domain + networking layer shared by the
// RetailGuard iOS app. Must not import UIKit/SwiftUI so it builds and tests on
// Linux CI as well as Apple platforms.
import PackageDescription

let package = Package(
    name: "RetailGuardCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "RetailGuardCore", targets: ["RetailGuardCore"]),
    ],
    targets: [
        .target(name: "RetailGuardCore", path: "Sources/RetailGuardCore"),
        .testTarget(name: "RetailGuardCoreTests", dependencies: ["RetailGuardCore"], path: "Tests/RetailGuardCoreTests"),
    ]
)
