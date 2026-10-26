// swift-tools-version: 6.0
import PackageDescription

/// Everything the Apple apps share that is not a screen: API client, models,
/// translations, design tokens and Swiss formatting.
let package = Package(
    name: "BatzioKit",
    defaultLocalization: "en",
    platforms: [.iOS(.v18), .macOS(.v15), .visionOS(.v2)],
    products: [.library(name: "BatzioKit", targets: ["BatzioKit"])],
    targets: [
        .target(name: "BatzioKit", resources: [.process("Resources")]),
        .testTarget(name: "BatzioKitTests", dependencies: ["BatzioKit"]),
    ]
)
