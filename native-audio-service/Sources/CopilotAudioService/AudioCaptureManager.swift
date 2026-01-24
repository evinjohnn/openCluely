import Foundation
import AVFoundation
import CoreAudio

/// Audio format constants for STT compatibility
enum AudioConstants {
    static let sampleRate: Double = 16000.0
    static let channelCount: AVAudioChannelCount = 1
    static let bitDepth: UInt32 = 16
    static let chunkDurationMs: Double = 100.0
    static let samplesPerChunk: AVAudioFrameCount = AVAudioFrameCount(sampleRate * chunkDurationMs / 1000.0)
}

/// Identifies the audio source for speaker labeling
enum AudioSource: String, Codable {
    case microphone = "user"
    case systemAudio = "interviewer"
}

/// Protocol for receiving audio chunks
protocol AudioCaptureDelegate: AnyObject {
    func audioCaptureManager(_ manager: AudioCaptureManager, didCapture chunk: Data, from source: AudioSource)
    func audioCaptureManager(_ manager: AudioCaptureManager, didEncounterError error: Error, from source: AudioSource)
    func audioCaptureManager(_ manager: AudioCaptureManager, deviceChanged deviceUID: String?, for source: AudioSource)
}

/// Manages dual audio capture from microphone and system audio (via virtual device)
final class AudioCaptureManager {
    
    // MARK: - Properties
    
    weak var delegate: AudioCaptureDelegate?
    
    private let micEngine = AVAudioEngine()
    private let systemEngine = AVAudioEngine()
    
    private var micConverter: AVAudioConverter?
    private var systemConverter: AVAudioConverter?
    
    private let processingQueue = DispatchQueue(label: "com.copilot.audio.processing", qos: .userInteractive)
    
    private var isCapturing = false
    private let stateLock = NSLock()
    
    /// Virtual audio device UID (e.g., BlackHole)
    /// TODO: Make configurable or auto-detect
    private let virtualDeviceUID: String
    
    // MARK: - Target Format
    
    private lazy var targetFormat: AVAudioFormat = {
        AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: AudioConstants.sampleRate,
            channels: AudioConstants.channelCount,
            interleaved: true
        )!
    }()
    
    // MARK: - Initialization
    
    init(virtualDeviceUID: String = "BlackHole2ch_UID") {
        self.virtualDeviceUID = virtualDeviceUID
        setupDeviceChangeNotifications()
    }
    
    deinit {
        stop()
        NotificationCenter.default.removeObserver(self)
    }
    
    // MARK: - Public Methods
    
    func start() throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        guard !isCapturing else { return }
        
        var micStarted = false
        var systemStarted = false
        
        // Try to start microphone (should always work if permission granted)
        do {
            try configureMicrophonePipeline()
            try micEngine.start()
            micStarted = true
            Logger.log("Microphone capture started", level: .info)
        } catch {
            Logger.log("Microphone capture failed: \(error)", level: .error)
        }
        
        // Try to start system audio (may fail if BlackHole not installed)
        do {
            try configureSystemAudioPipeline()
            try systemEngine.start()
            systemStarted = true
            Logger.log("System audio capture started", level: .info)
        } catch {
            Logger.log("System audio capture failed: \(error)", level: .warning)
            Logger.log("Install BlackHole for system audio: brew install blackhole-2ch", level: .info)
        }
        
        // At least one source must work
        guard micStarted || systemStarted else {
            throw AudioCaptureError.invalidInputFormat
        }
        
        isCapturing = true
        Logger.log("AudioCaptureManager started (mic: \(micStarted), system: \(systemStarted))", level: .info)
    }
    
    func stop() {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        guard isCapturing else { return }
        
        micEngine.stop()
        systemEngine.stop()
        
        micEngine.inputNode.removeTap(onBus: 0)
        systemEngine.inputNode.removeTap(onBus: 0)
        
        isCapturing = false
        Logger.log("AudioCaptureManager stopped", level: .info)
    }
    
    func pause() {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        micEngine.pause()
        systemEngine.pause()
        Logger.log("AudioCaptureManager paused", level: .info)
    }
    
    func resume() throws {
        stateLock.lock()
        defer { stateLock.unlock() }
        
        try micEngine.start()
        try systemEngine.start()
        Logger.log("AudioCaptureManager resumed", level: .info)
    }
    
    // MARK: - Private Methods
    
    private func configureMicrophonePipeline() throws {
        let inputNode = micEngine.inputNode
        // Check permission
        if #available(macOS 10.14, *) {
            let status = AVCaptureDevice.authorizationStatus(for: .audio)
            Logger.log("Microphone Permission Status: \(status.rawValue) (0=notDetermined, 1=restricted, 2=denied, 3=authorized)", level: .info)
        }

        // Enable echo cancellation (Voice Processing I/O)
        // This prevents the mic from picking up the interviewer's voice from speakers
        if #available(macOS 11.0, *) {
            do {
                try inputNode.setVoiceProcessingEnabled(true)
                Logger.log("Voice processing (echo cancellation) enabled", level: .info)
            } catch {
                Logger.log("Failed to enable voice processing: \(error)", level: .warning)
            }
        }
        
        let inputFormat = inputNode.outputFormat(forBus: 0)
        Logger.log("Microphone Input Format: \(inputFormat)", level: .info)
        
        guard inputFormat.sampleRate > 0 else {
            throw AudioCaptureError.invalidInputFormat
        }
        
        // Create converter for sample rate and format conversion
        micConverter = AVAudioConverter(from: inputFormat, to: targetFormat)
        guard let converter = micConverter else {
            throw AudioCaptureError.converterCreationFailed
        }
        
        // If input has multiple channels, force use of the first one to avoid silence if others are empty
        if inputFormat.channelCount > 1 {
            // Map input channel 0 to output channel 0
            converter.channelMap = [0] 
            Logger.log("Applied channel map: [0] (Input has \(inputFormat.channelCount) channels)", level: .info)
        }
        
        // Calculate buffer size for ~100ms chunks at input sample rate
        let inputBufferSize = AVAudioFrameCount(inputFormat.sampleRate * AudioConstants.chunkDurationMs / 1000.0)
        
        inputNode.installTap(onBus: 0, bufferSize: inputBufferSize, format: inputFormat) { [weak self] buffer, time in
            self?.processAudioBuffer(buffer, converter: converter, source: .microphone)
        }
    }
    
    private func configureSystemAudioPipeline() throws {
        // Find and set the virtual audio device as input
        try setInputDevice(uid: virtualDeviceUID, for: systemEngine)
        
        let inputNode = systemEngine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)
        
        guard inputFormat.sampleRate > 0 else {
            throw AudioCaptureError.invalidInputFormat
        }
        
        systemConverter = AVAudioConverter(from: inputFormat, to: targetFormat)
        guard let converter = systemConverter else {
            throw AudioCaptureError.converterCreationFailed
        }
        
        let inputBufferSize = AVAudioFrameCount(inputFormat.sampleRate * AudioConstants.chunkDurationMs / 1000.0)
        
        inputNode.installTap(onBus: 0, bufferSize: inputBufferSize, format: inputFormat) { [weak self] buffer, time in
            self?.processAudioBuffer(buffer, converter: converter, source: .systemAudio)
        }
    }
    
    private func setInputDevice(uid: String, for engine: AVAudioEngine) throws {
        var deviceID: AudioDeviceID = 0
        var propertySize = UInt32(MemoryLayout<AudioDeviceID>.size)
        
        // Get device ID from UID
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        
        var uidCF = uid as CFString
        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            UInt32(MemoryLayout<CFString>.size),
            &uidCF,
            &propertySize,
            &deviceID
        )
        
        guard status == noErr, deviceID != 0 else {
            throw AudioCaptureError.deviceNotFound(uid: uid)
        }
        
        // Set as input device for the engine's audio unit
        let audioUnit = engine.inputNode.audioUnit!
        var enableIO: UInt32 = 1
        
        // Enable input
        AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_EnableIO,
            kAudioUnitScope_Input,
            1,
            &enableIO,
            UInt32(MemoryLayout<UInt32>.size)
        )
        
        // Set device
        AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &deviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )
    }
    
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer, converter: AVAudioConverter, source: AudioSource) {
        processingQueue.async { [weak self] in
            guard let self = self else { return }
            
            do {
                let convertedData = try self.convertToTargetFormat(buffer: buffer, converter: converter)
                // Logger.log("Audio converted \(source.rawValue): \(convertedData.count) bytes", level: .debug)
                
                // Check for silence
                self.checkSilence(data: convertedData, source: source)
                
                self.delegate?.audioCaptureManager(self, didCapture: convertedData, from: source)
            } catch {
                Logger.log("Audio conversion error \(source.rawValue): \(error)", level: .error)
                self.delegate?.audioCaptureManager(self, didEncounterError: error, from: source)
            }
        }
    }
    
    private func checkSilence(data: Data, source: AudioSource) {
        let sampleCount = data.count / MemoryLayout<Int16>.size
        guard sampleCount > 0 else { return }
        
        data.withUnsafeBytes { buffer in
            guard let int16Buffer = buffer.bindMemory(to: Int16.self).baseAddress else { return }
            
            var sum: Float = 0
            // Check sample subset to save CPU
            let step = 10
            let iterations = sampleCount / step
            
            guard iterations > 0 else { return }
            
            for i in 0..<iterations {
                let sample = Float(int16Buffer[i * step])
                sum += sample * sample
            }
            
            let rms = sqrt(sum / Float(iterations))
            
            // Threshold for "silence" - typically purely digital silence is 0, but low noise floor might be < 100
            if rms < 50.0 {
                // Only log occasionally or it will spam
                // implementation detail: could add a rate limiter here, but for now we just log
                 Logger.log("Potential silence from \(source.rawValue) (RMS: \(Int(rms)))", level: .warning)
            }
        }
    }
    
    private func convertToTargetFormat(buffer: AVAudioPCMBuffer, converter: AVAudioConverter) throws -> Data {
        let frameCapacity = AVAudioFrameCount(
            Double(buffer.frameLength) * AudioConstants.sampleRate / buffer.format.sampleRate
        )
        
        guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCapacity) else {
            throw AudioCaptureError.bufferCreationFailed
        }
        
        var error: NSError?
        let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
            outStatus.pointee = .haveData
            return buffer
        }
        
        let status = converter.convert(to: outputBuffer, error: &error, withInputFrom: inputBlock)
        
        if let error = error {
            throw error
        }
        
        // Fix: Ensure we actually got data
        guard status != .error && outputBuffer.frameLength > 0 else {
            // Return empty data instead of throwing if it's just a momentary gap
            return Data()
        }
        
        // Extract PCM data as Int16
        guard let int16Data = outputBuffer.int16ChannelData else {
            throw AudioCaptureError.invalidOutputFormat
        }
        
        let byteCount = Int(outputBuffer.frameLength) * MemoryLayout<Int16>.size
        return Data(bytes: int16Data[0], count: byteCount)
    }
    
    // MARK: - Device Change Handling
    
    private func setupDeviceChangeNotifications() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleConfigurationChange),
            name: .AVAudioEngineConfigurationChange,
            object: nil
        )
    }
    
    @objc private func handleConfigurationChange(_ notification: Notification) {
        // Only handle if we're actually capturing and it's our engine
        guard isCapturing else { return }
        
        // Check which engine triggered the change
        let triggeredByMic = notification.object as? AVAudioEngine === micEngine
        let triggeredBySystem = notification.object as? AVAudioEngine === systemEngine
        
        guard triggeredByMic || triggeredBySystem else { return }
        
        Logger.log("Audio configuration changed (mic: \(triggeredByMic), system: \(triggeredBySystem))", level: .warning)
        Logger.log("Engine states - Mic: \(micEngine.isRunning), System: \(systemEngine.isRunning)", level: .warning)
        
        // Debounce restarts to prevent loops using a simple work item cancellation approach
        // (Note: Simple delay is sufficient here as we just want to back off slightly)
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.performRestart()
        }
    }
    
    private func performRestart() {
        // Needs locking to check state safely, but performRestart calls stop/start which lock
        // So we just call them.
        
        Logger.log("Performing engine restart...", level: .info)
        
        // Stop everything first
        stop()
        
        // Re-configure and start
        do {
            try start() 
            Logger.log("Engine restart successful", level: .info)
        } catch {
            Logger.log("Engine restart failed: \(error)", level: .error)
        }
    }
}

// MARK: - Errors

enum AudioCaptureError: Error, LocalizedError {
    case invalidInputFormat
    case converterCreationFailed
    case bufferCreationFailed
    case conversionFailed
    case invalidOutputFormat
    case deviceNotFound(uid: String)
    case permissionDenied
    
    var errorDescription: String? {
        switch self {
        case .invalidInputFormat:
            return "Invalid input audio format"
        case .converterCreationFailed:
            return "Failed to create audio converter"
        case .bufferCreationFailed:
            return "Failed to create output buffer"
        case .conversionFailed:
            return "Audio conversion failed"
        case .invalidOutputFormat:
            return "Invalid output format"
        case .deviceNotFound(let uid):
            return "Audio device not found: \(uid)"
        case .permissionDenied:
            return "Microphone permission denied"
        }
    }
}
