import Foundation
import NIO
import WebSocketKit
import NIOCore
import NIOFoundationCompat
import Dispatch

// JSON Payload for sending audio
struct STTPacket: Codable {
    let speaker: String
    let audio: String // Hex encoded PCM
}

// JSON Payload for receiving transcripts
struct STTResponse: Codable {
    let type: String
    let speaker: String
    let text: String
    let final: Bool
    let confidence: Double?
}

final class LocalSTTClient: STTStreamProtocol {
    
    // MARK: - Properties
    
    weak var delegate: STTStreamDelegate?
    
    let source: AudioSource
    private let eventLoopGroup: EventLoopGroup
    private var webSocket: WebSocket?
    private var isConnected = false
    private let reconnectDelay: TimeInterval = 1.0
    private var shouldReconnect = true
    
    private let serverURL = "ws://127.0.0.1:8765"
    
    // MARK: - Initialization
    
    init(source: AudioSource, eventLoopGroup: EventLoopGroup) {
        self.source = source
        self.eventLoopGroup = eventLoopGroup
    }
    
    // MARK: - STTStreamProtocol
    
    func connect() {
        shouldReconnect = true
        connectWebSocket()
    }
    
    func disconnect() {
        shouldReconnect = false
        _ = webSocket?.close()
        webSocket = nil
    }
    
    func sendAudio(_ audioData: Data) {
        guard isConnected, let ws = webSocket else { return }
        
        // Convert to hex
        let hexAudio = audioData.map { String(format: "%02hhx", $0) }.joined()
        
        let packet = STTPacket(
            speaker: source.rawValue,
            audio: hexAudio
        )
        
        do {
            let jsonData = try JSONEncoder().encode(packet)
            if let jsonString = String(data: jsonData, encoding: .utf8) {
                ws.send(jsonString)
            }
        } catch {
            Logger.log("Failed to encode audio packet: \(error)", level: .error)
        }
    }
    
    // MARK: - Private Methods
    
    private func connectWebSocket() {
        guard shouldReconnect else { return }
        
        WebSocket.connect(to: serverURL, on: eventLoopGroup) { [weak self] ws in
            guard let self = self else { return }
            self.webSocket = ws
            self.isConnected = true
            
            Logger.log("LocalSTTClient connected for \(self.source.rawValue)", level: .info)
            self.delegate?.sttStreamDidConnect(self)
            
            ws.onText { ws, text in
                self.handleMessage(text)
            }
            
            ws.onClose.whenComplete { result in
                self.isConnected = false
                self.delegate?.sttStreamDidDisconnect(self)
                self.scheduleReconnect()
            }
            
        }.whenFailure { [weak self] error in
            Logger.log("LocalSTTClient connection failed for \(self?.source.rawValue ?? "unknown"): \(error)", level: .error)
            self?.scheduleReconnect()
        }
    }
    
    private func scheduleReconnect() {
        guard shouldReconnect else { return }
        
        // Simple delay before retry
        DispatchQueue.global().asyncAfter(deadline: .now() + reconnectDelay) { [weak self] in
            self?.connectWebSocket()
        }
    }
    
    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        
        do {
            let response = try JSONDecoder().decode(STTResponse.self, from: data)
            
            // Only process transcripts matching our source (though server handles both, we filter for clarity if shared socket used improperly, valid check)
            // Actually, the server keeps buffers separate but sends all transcripts to the socket.
            // So we need to ensure we route them correctly or handle them.
            // Since we have multiple LocalSTTClient instances (one per source) but they might connect to same server,
            // we should filter by speaker.
            
            guard response.speaker == source.rawValue else { return }
            
            let segment = TranscriptSegment(
                speaker: response.speaker,
                text: response.text,
                timestamp: Date().timeIntervalSince1970, // Approximate
                isFinal: response.final,
                confidence: response.confidence ?? 1.0
            )
            
            self.delegate?.sttStream(self, didReceive: segment)
            
        } catch {
            Logger.log("Failed to decode STT response: \(error)", level: .error)
        }
    }
}
