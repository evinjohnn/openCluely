import Foundation
import NIO
// import GRPC // Removed Google GRPC dependency

/// Represents a piece of transcription
struct TranscriptSegment: Codable, CustomStringConvertible {
    let speaker: String
    let text: String
    let timestamp: TimeInterval
    let isFinal: Bool
    let confidence: Double
    
    var description: String {
        return "[\(speaker)] \(text) (final: \(isFinal))"
    }
}

/// Delegate for receiving STT events
protocol STTStreamDelegate: AnyObject {
    func sttStream(_ stream: STTStreamProtocol, didReceive transcript: TranscriptSegment)
    func sttStream(_ stream: STTStreamProtocol, didEncounterError error: Error)
    func sttStreamDidConnect(_ stream: STTStreamProtocol)
    func sttStreamDidDisconnect(_ stream: STTStreamProtocol)
}

/// Protocol for STT Streaming implementations
protocol STTStreamProtocol: AnyObject {
    var delegate: STTStreamDelegate? { get set }
    func connect()
    func sendAudio(_ audioData: Data)
    func disconnect()
}

// AudioSource is defined in AudioCaptureManager.swift

/// Manages multiple STT streams (mic + system)
final class STTManager {
    
    weak var delegate: STTStreamDelegate? {
        didSet {
            streams.values.forEach { $0.delegate = delegate }
        }
    }
    
    private var streams: [AudioSource: STTStreamProtocol] = [:]
    
    private let eventLoopGroup: EventLoopGroup
    
    init() {
        // Use PlatformSupport to get the native OS event loop (NIOTS on macOS)
        self.eventLoopGroup = MultiThreadedEventLoopGroup(numberOfThreads: 2)
    }
    
    deinit {
        try? eventLoopGroup.syncShutdownGracefully()
    }
    
    func startStream(for source: AudioSource) {
        Logger.log("STTManager: Starting Local STT stream for \(source.rawValue)", level: .info)
        
        let stream = LocalSTTClient(
            source: source,
            eventLoopGroup: eventLoopGroup
        )
        stream.delegate = delegate
        stream.connect()
        streams[source] = stream
    }
    
    func sendAudio(_ data: Data, to source: AudioSource) {
        if let stream = streams[source] {
            stream.sendAudio(data)
        } else {
            // Logger.log("STTManager: No stream for \(source.rawValue)! Available: \(streams.keys.map { $0.rawValue })", level: .warning)
        }
    }
    
    func stopAll() {
        defer {
             streams.removeAll()
        }
        
        for (source, stream) in streams {
            Logger.log("Stopping stream: \(source.rawValue)", level: .info)
            stream.disconnect()
        }
    }
}
