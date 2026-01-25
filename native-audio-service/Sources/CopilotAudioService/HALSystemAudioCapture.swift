import Foundation
import AudioToolbox
import CoreAudio
import AVFoundation

final class HALSystemAudioCapture {

    enum CaptureError: Error {
        case deviceNotFound
        case audioUnitInitFailed
        case streamFormatFailed
        case converterFailed
    }

    // MARK: - Public API

    var onAudioData: ((Data) -> Void)?

    fileprivate var audioUnit: AudioUnit?
    private var deviceID: AudioDeviceID = 0
    fileprivate var converter: AVAudioConverter?
    
    // Target format: 16kHz Mono Int16
    fileprivate let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    
    // Captured format (device native)
    fileprivate var capturedFormat: AVAudioFormat?

    func start(virtualDeviceUID: String) throws {
        try setupDevice(uid: virtualDeviceUID)
        try setupAudioUnit()
        try startAudioUnit()
    }

    func stop() {
        if let audioUnit = audioUnit {
            AudioOutputUnitStop(audioUnit)
            AudioUnitUninitialize(audioUnit)
        }
        audioUnit = nil
        converter = nil
    }

    // MARK: - Device Lookup

    private func setupDevice(uid: String) throws {
        var uidCF = uid as CFString
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)

        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslateUIDToDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )

        let status = AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            UInt32(MemoryLayout<CFString>.size),
            &uidCF,
            &size,
            &deviceID
        )

        guard status == noErr, deviceID != 0 else {
            throw CaptureError.deviceNotFound
        }
    }

    // MARK: - Audio Unit Setup

    private func setupAudioUnit() throws {
        var desc = AudioComponentDescription(
            componentType: kAudioUnitType_Output,
            componentSubType: kAudioUnitSubType_HALOutput,
            componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0,
            componentFlagsMask: 0
        )

        guard let component = AudioComponentFindNext(nil, &desc) else {
            throw CaptureError.audioUnitInitFailed
        }

        var unit: AudioUnit?
        let status = AudioComponentInstanceNew(component, &unit)
        guard status == noErr, let audioUnit = unit else {
            throw CaptureError.audioUnitInitFailed
        }

        self.audioUnit = audioUnit

        // Enable input capture (from the device)
        var enableIO: UInt32 = 1
        AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_EnableIO,
            kAudioUnitScope_Input, // Enable Input Scope (Element 1)
            1,
            &enableIO,
            UInt32(MemoryLayout<UInt32>.size)
        )

        // Disable output (to the device)
        var disableIO: UInt32 = 0
        AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_EnableIO,
            kAudioUnitScope_Output, // Disable Output Scope (Element 0)
            0,
            &disableIO,
            UInt32(MemoryLayout<UInt32>.size)
        )

        // Attach device
        var deviceID = self.deviceID
        AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_CurrentDevice,
            kAudioUnitScope_Global,
            0,
            &deviceID,
            UInt32(MemoryLayout<AudioDeviceID>.size)
        )



        // --- NEW LOGIC: Use Device Native Format for AU, then Convert ---
        
        // Get the device's actual current stream format
        var deviceFormat = AudioStreamBasicDescription()
        var propertySize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        
        // We need to get the stream format of the Input Scope of the AU (Element 1)
        // Which should default to the Hardware Format
        let getFormatStatus = AudioUnitGetProperty(
            audioUnit,
            kAudioUnitProperty_StreamFormat,
            kAudioUnitScope_Input,
            1,
            &deviceFormat,
            &propertySize
        )
        
        guard getFormatStatus == noErr else {
             throw CaptureError.streamFormatFailed
        }
        

        
        if let avFormat = AVAudioFormat(streamDescription: &deviceFormat) {
            self.capturedFormat = avFormat
            Logger.log("HAL Device Native Format: \(deviceFormat.mSampleRate)Hz, \(deviceFormat.mChannelsPerFrame)ch (AVFormat: \(avFormat))", level: .info)
        } else {
             Logger.log("Failed to create AVAudioFormat from device format", level: .error)
             throw CaptureError.streamFormatFailed
        }
        
        // Set the AU Output (Scope Output, Element 1) to match the Input (Device Native)
        
        // Set the AU Output (Scope Output, Element 1) to match the Input (Device Native)
        // This ensures the AU just passes data through without trying to resampling itself (which often fails)
        let setFormatStatus = AudioUnitSetProperty(
            audioUnit,
            kAudioUnitProperty_StreamFormat,
            kAudioUnitScope_Output,
            1, 
            &deviceFormat,
            UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        )

        guard setFormatStatus == noErr else {
            throw CaptureError.streamFormatFailed
        }
        
        // Initialize the AVAudioConverter
        // Convert from Device Format (Float32 usually) to Target (16kHz Int16)
        if let sourceFormat = AVAudioFormat(streamDescription: &deviceFormat) {
            self.converter = AVAudioConverter(from: sourceFormat, to: targetFormat)
            if deviceFormat.mChannelsPerFrame > 1 {
                 self.converter?.channelMap = [0] // Mix or take Channel 0
            }
        } else {
            throw CaptureError.streamFormatFailed
        }

        // Set Input Callback (to receive data)
        var callback = AURenderCallbackStruct(
            inputProc: renderCallback,
            inputProcRefCon: UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
        )

        AudioUnitSetProperty(
            audioUnit,
            kAudioOutputUnitProperty_SetInputCallback, // Correct Property for Input
            kAudioUnitScope_Global,
            0,
            &callback,
            UInt32(MemoryLayout<AURenderCallbackStruct>.size)
        )

        let initStatus = AudioUnitInitialize(audioUnit)
        guard initStatus == noErr else {
             throw CaptureError.audioUnitInitFailed
        }
    }

    private func startAudioUnit() throws {
        guard let audioUnit = audioUnit else { throw CaptureError.audioUnitInitFailed }
        let status = AudioOutputUnitStart(audioUnit)
        guard status == noErr else { throw CaptureError.audioUnitInitFailed }
    }
}

// MARK: - Render Callback

private func renderCallback(
    inRefCon: UnsafeMutableRawPointer,
    ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    inTimeStamp: UnsafePointer<AudioTimeStamp>,
    inBusNumber: UInt32,
    inNumberFrames: UInt32,
    ioData: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {

    let capture = Unmanaged<HALSystemAudioCapture>
        .fromOpaque(inRefCon)
        .takeUnretainedValue()

    guard let audioUnit = capture.audioUnit,
          let format = capture.capturedFormat else {
        return kAudioUnitErr_Uninitialized
    }
    
    // Create a buffer compatible with the device format
    // This handles multi-channel / non-interleaved logic automatically
    guard let inputBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: inNumberFrames) else {
        return kAudioUnitErr_FormatNotSupported
    }
    
    // AudioUnitRender wants an AudioBufferList. AVAudioPCMBuffer provides a mutable pointer to one.
    // However, we need to populate the mDataByteSize correctly before calling render?
    // AVAudioPCMBuffer usually sets this up based on frameCapacity.
    // BUT AudioUnitRender writes TO the mData pointers.
    // Note: AVAudioPCMBuffer allocates the memory. We just pass the pointers.
    
    // We need to set .mDataByteSize safely? 
    // Usually AudioUnitRender overwrites it or respects it.
    // Let's rely on the buffer's configured list.
    
    let bufferListPtr = UnsafeMutableAudioBufferListPointer(inputBuffer.mutableAudioBufferList)
    
    for i in bufferListPtr.indices {
        bufferListPtr[i].mDataByteSize = inNumberFrames * format.streamDescription.pointee.mBytesPerFrame
    }

    let status = AudioUnitRender(
        audioUnit,
        ioActionFlags,
        inTimeStamp,
        1,
        inNumberFrames,
        inputBuffer.mutableAudioBufferList
    )

    guard status == noErr else {
        return status
    }
    
    // Verify we actually got something
    let capturedBytes = Int(inputBuffer.frameLength) * Int(format.streamDescription.pointee.mBytesPerFrame)
    // Logger.log("HAL Captured: \(inputBuffer.frameLength) frames, \(capturedBytes) bytes", level: .debug)
    
    // Safety check for silence/zeroes?
    // if let data = inputBuffer.floatChannelData?[0] {
    //      // Check RMS? Too expensive for now.
    // }
    
    // Create conversion output
    // Calculate output size needed (16k vs Native)
    let ratio = 16000.0 / format.sampleRate
    let outputFrameCapacity = AVAudioFrameCount(Double(inNumberFrames) * ratio * 2.0) + 100 // safe margin
    
    guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: capture.targetFormat, frameCapacity: outputFrameCapacity) else {
        return noErr
    }
    
    var error: NSError?
    
    guard let converter = capture.converter else { return noErr }
    
    // Conversion Input Block
    var inputBufferUsed = false
    let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
        if inputBufferUsed {
            outStatus.pointee = .noDataNow
            return nil
        }
        inputBufferUsed = true
        outStatus.pointee = .haveData
        return inputBuffer
    }
    
    converter.convert(to: outputBuffer, error: &error, withInputFrom: inputBlock)
    
    if let err = error {
        // Suppress "No Data" errors if just end of stream
        Logger.log("HAL Convert Error: \(err)", level: .error)
        return noErr
    }
    
    if outputBuffer.frameLength > 0, let int16Data = outputBuffer.int16ChannelData {
         let byteCount = Int(outputBuffer.frameLength) * MemoryLayout<Int16>.size
         let pcmData = Data(bytes: int16Data[0], count: byteCount)
         
         // Logger.log("HAL Converted: \(outputBuffer.frameLength) frames, \(byteCount) bytes", level: .debug)
         capture.onAudioData?(pcmData)
    } else {
         Logger.log("HAL Conversion yielded 0 frames", level: .warning)
    }

    return noErr
}
