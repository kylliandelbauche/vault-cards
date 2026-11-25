// swift-tools-version:5.10
import PackageDescription

// Cœur de l'app native (spec docs/specs/2026-11-25-app-apple-native.md) : Foundation seule, aucune UI ni base.
let package = Package(
    name: "VaultCardsCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "VaultCardsCore", targets: ["VaultCardsCore"]),
    ],
    targets: [
        .target(name: "VaultCardsCore"),
        .testTarget(
            name: "VaultCardsCoreTests",
            dependencies: ["VaultCardsCore"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
