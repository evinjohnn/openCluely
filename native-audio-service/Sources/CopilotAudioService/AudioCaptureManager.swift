import Foundation
import AVFoundation

/// Audio format constants for STT compatibility
enum AudioConstants {
    static let sampleRate: Double = 16000.0
    static let channelCount: AVAudioChannelCount = 1
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

/// Manages multi-source audio capture (Microphone + System Audio via Virtual Device) using AVCaptureSession
final class AudioCaptureManager: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
    
    weak var delegate: AudioCaptureDelegate?
    
    private let virtualDeviceUID: String
    private var captureSession: AVCaptureSession?
    
    private var micInput: AVCaptureDeviceInput?
    private var systemInput: AVCaptureDeviceInput?
    
    private let processingQueue = DispatchQueue(label: "com.copilot.audio.processing", qos: .userInteractive)
    
    private var isRunning = false
    private var isPaused = false
    
    private var audioConverter: AudioConverterRef?
    private var sourceBuffer = UnsafeMutableRawPointer.allocate(byteCount: 32768, alignment: 16)
    
    init(virtualDeviceUID: String = "BlackHole2ch_UID") {
        self.virtualDeviceUID = virtualDeviceUID
        super.init()
        setupSession()
    }
    
    deinit {
        stop()
        sourceBuffer.deallocate()
    }
    
    private func setupSession() {
        let session = AVCaptureSession()
        session.beginConfiguration()
        
        // 1. Setup Microphone
        if let mic = AVCaptureDevice.default(for: .audio) {
            do {
                let input = try AVCaptureDeviceInput(device: mic)
                if session.canAddInput(input) {
                    session.addInput(input)
                    self.micInput = input
                    Logger.log("Microphone added: \(mic.localizedName)", level: .info)
                }
            } catch {
                Logger.log("AudioCapture: Failed to setup mic: \(error)", level: .error)
            }
        }
        
        // 2. Setup System Audio (via BlackHole/Virtual Device)
        if let systemDevice = findDevice(byUID: virtualDeviceUID) {
            do {
                let input = try AVCaptureDeviceInput(device: systemDevice)
                if session.canAddInput(input) {
                    session.addInput(input)
                    self.systemInput = input
                    Logger.log("System audio added: \(systemDevice.localizedName)", level: .info)
                }
            } catch {
                Logger.log("AudioCapture: Failed to setup system audio: \(error)", level: .error)
            }
        } else {
            Logger.log("AudioCapture: Virtual device \(virtualDeviceUID) not found.", level: .warning)
        }
        
        // 3. Setup Output
        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(self, queue: processingQueue)
        
        if session.canAddOutput(output) {
            session.addOutput(output)
        }
        
        session.commitConfiguration()
        self.captureSession = session
    }
    
    private func findDevice(byUID uid: String) -> AVCaptureDevice? {
        let devices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInMicrophone, .externalUnknown],
            mediaType: .audio,
            position: .unspecified
        ).devices
        
        return devices.first { $0.uniqueID == uid }
    }
    
    func start() throws {
        guard !isRunning, let session = captureSession else { return }
        
        processingQueue.async {
            session.startRunning()
            self.isRunning = true
            Logger.log("AudioCaptureManager session started", level: .info)
        }
    }
    
    func stop() {
        guard isRunning, let session = captureSession else { return }
        processingQueue.async {
            session.stopRunning()
            self.isRunning = false
            Logger.log("AudioCaptureManager session stopped", level: .info)
        }
    }
    
    func pause() {
        isPaused = true
    }
    
    func resume() throws {
        isPaused = false
    }
    
    // MARK: - AVCaptureAudioDataOutputSampleBufferDelegate
    
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !isPaused else { return }
        
        // Identify source
        var source: AudioSource = .microphone
        // Trace back the connection to the input port
        if let inputPort = connection.inputPorts.first,
           let input = inputPort.input as? AVCaptureDeviceInput {
            if input == systemInput {
                source = .systemAudio
            }
        }
        
        // Extract Data
        guard let pcmData = convertToTargetFormat(sampleBuffer) else { return }
        
        // RMS Logging for debugging
        let rms = pcmData.withUnsafeBytes { buffer -> Double in
            guard let ptr = buffer.bindMemory(to: Int16.self).baseAddress else { return 0 }
            let count = pcmData.count / 2
            if count == 0 { return 0 }
            var sum: Double = 0
            // Optimization: sample every 10th frame for logging speed
            let stride = 10
            let loopCount = count / stride
            if loopCount == 0 { return 0 }
            
            for i in 0..<loopCount {
                let sample = Double(ptr[i * stride])
                sum += sample * sample
            }
            return sqrt(sum / Double(loopCount))
        }
        
        if rms > 10 { // Only log valid signal
             Logger.log("Captured \(source.rawValue): \(pcmData.count) bytes, RMS: \(String(format: "%.1f", rms))", level: .info)
        }
        
        delegate?.audioCaptureManager(self, didCapture: pcmData, from: source)
    }
    
    private func convertToTargetFormat(_ sampleBuffer: CMSampleBuffer) -> Data? {
        // Needs proper resampling/conversion logic using AudioConverter
        // For now, let's assume raw extraction if format is compatible, or basic conversion.
        // Implementing full AudioConverter for CMSampleBuffer is verbose.
        // Simplified approach: Extract buffer, check format. If roughly same, return.
        
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer),
              let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else { return nil }
        
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)?.pointee
        
        // Helper: Direct extraction (works if input is already PCM)
        var length = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        
        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)
        
        if status == kCMBlockBufferNoErr, let pointer = dataPointer {
             // If input is Float32, convert to Int16
             if let asbd = asbd, asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0, asbd.mBitsPerChannel == 32 {
                 // Float to Int16 Conversion
                 let floatCount = length / 4
                 let floatBuffer = UnsafeMutablePointer<Float>(OpaquePointer(pointer))
                 
                 var pcmData = Data(count: floatCount * 2)
                 pcmData.withUnsafeMutableBytes { targetBuffer in
                     let targetPtr = targetBuffer.bindMemory(to: Int16.self).baseAddress!
                     for i in 0..<floatCount {
                         let f = floatBuffer[i]
                         // Clamp and scale
                         var v = f * 32767.0
                         if v > 32767.0 { v = 32767.0 }
                         if v < -32768.0 { v = -32768.0 }
                         targetPtr[i] = Int16(v)
                     }
                 }
                 return pcmData
             } else {
                 // Assume Int16 or compatible
                 return Data(bytes: pointer, count: length)
             }
        }
        
        return nil
    }
}
