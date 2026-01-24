// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "CopilotAudioService",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "copilot-audio-service", targets: ["CopilotAudioService"])
    ],
    dependencies: [
        // WebSocket server
        .package(url: "https://github.com/vapor/vapor.git", from: "4.89.0"),
        // WebSocket client (can likely remove Starscream if we move entirely to gRPC for STT, but keeping for Deepgram fallback)
        .package(url: "https://github.com/daltoniam/Starscream.git", from: "4.0.0"),
        // gRPC and Protobuf
        .package(url: "https://github.com/grpc/grpc-swift.git", from: "1.20.0"),
        .package(url: "https://github.com/apple/swift-protobuf.git", from: "1.27.0"),
        // JWT for Service Account Auth
        .package(url: "https://github.com/Kitura/Swift-JWT.git", from: "4.0.0")
    ],
    targets: [
        .executableTarget(
            name: "CopilotAudioService",
            dependencies: [
                .product(name: "Vapor", package: "vapor"),
                .product(name: "Starscream", package: "Starscream"),
                .product(name: "GRPC", package: "grpc-swift"),
                .product(name: "SwiftProtobuf", package: "swift-protobuf"),
                .product(name: "SwiftJWT", package: "Swift-JWT")
            ],
            path: "Sources/CopilotAudioService"
        )
    ]
)
