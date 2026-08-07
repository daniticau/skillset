// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SkillsetDesktop",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Skillset", targets: ["SkillsetApp"]),
    ],
    targets: [
        .executableTarget(
            name: "SkillsetApp",
            path: "Sources/SkillsetApp"
        ),
        .testTarget(
            name: "SkillsetAppTests",
            dependencies: ["SkillsetApp"],
            path: "Tests/SkillsetAppTests"
        ),
    ]
)
