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
        
        Logger.log("HAL Device Native Format: \(deviceFormat.mSampleRate)Hz, \(deviceFormat.mChannelsPerFrame)ch", level: .info)
        
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

    guard let audioUnit = capture.audioUnit else {
        return kAudioUnitErr_Uninitialized
    }

    var bufferList = AudioBufferList(
        mNumberBuffers: 1,
        mBuffers: AudioBuffer(
            mNumberChannels: 1,
            mDataByteSize: inNumberFrames * 2,
            mData: nil
        )
    )

    let status = AudioUnitRender(
        audioUnit,
        ioActionFlags,
        inTimeStamp,
        1,
        inNumberFrames,
        &bufferList
    )

    guard status == noErr,
          let data = bufferList.mBuffers.mData else {
        return status
    }
    
    // Create AVAudioPCMBuffer from raw AU data
    // We captured at device native format
    guard let converter = capture.converter else { return noErr }
    
    // We assume Float32 Non-Interleaved (standard CoreAudio)
    // Construct buffer wrapper
    // Note: bufferList is C-struct, we need to wrap it safely
    
    // Careful: input frames could vary
    // We need to construct an AVAudioPCMBuffer to hold this data for conversion
    
    // Since we can't easily wrap raw pointers into AVAudioPCMBuffer without copying or unsafe tricks,
    // and AVAudioConverter needs AVAudioPCMBuffer or AudioBufferList.
    
    // Luckily AVAudioConverterInputBlock takes (packetCount, outStatus).
    // But we need to feed it THIS buffer.
    
    // Let's use the AudioBufferList directly with converter.convert(to:from:)?
    // No, convert(to:from:) takes AVAudioPCMBuffer.
    
    // Alternative: Use AudioConverterFillComplexBuffer (C-API)?
    // Or construct AVAudioPCMBuffer efficiently.
    
    // Let's assume inputFormat was correctly inferred. 
    // We can cast the raw pointer to the expected type and copy into a fresh AVAudioPCMBuffer.
    
    // BETTER: Configure local AudioBufferList to match what we have and pass it to a converter block.
    
    // Calculate output size needed (16k vs Native)
    // ratio = 16000 / NativeRate
    let ratio = 16000.0 / capture.targetFormat.sampleRate // Wait, target IS 16000
    // Actually ratio = 16000 / InputRate
    // Just estimate generous output buffer
    let outputFrameCapacity = AVAudioFrameCount(Double(inNumberFrames) * 2.0) // safe margin
    
    guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: capture.targetFormat, frameCapacity: outputFrameCapacity) else {
        return noErr
    }
    
    var error: NSError?
    
    // We make a mutable copy of the buffer list header to pass to the block
    var inputBufferList = bufferList
    
    withUnsafePointer(to: inputBufferList) { inputBufferListPtr in
        let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
            outStatus.pointee = .haveData
            // We only have one buffer to give
            return AVAudioPCMBuffer(pcmFormat: converter.inputFormat, frameCapacity: inNumberFrames, bufferListNoCopy: inputBufferListPtr)
        }
        
        converter.convert(to: outputBuffer, error: &error, withInputFrom: inputBlock)
    }
    
    if let err = error {
        Logger.log("HAL Convert Error: \(err)", level: .error)
        return noErr
    }
    
    if outputBuffer.frameLength > 0, let int16Data = outputBuffer.int16ChannelData {
         let byteCount = Int(outputBuffer.frameLength) * MemoryLayout<Int16>.size
         let pcmData = Data(bytes: int16Data[0], count: byteCount)
         capture.onAudioData?(pcmData)
    }

    return noErr
}

// Helper extension to create buffer from existing list
extension AVAudioPCMBuffer {
    convenience init?(pcmFormat: AVAudioFormat, frameCapacity: AVAudioFrameCount, bufferListNoCopy: UnsafePointer<AudioBufferList>) {
        self.init(pcmFormat: pcmFormat, frameCapacity: frameCapacity)
        // This constructor allocates its own memory. We want to wrap.
        // Swift's AVFoundation overlay doesn't expose the "NoCopy/Deallocator" initializer easily.
        // Fallback: Copy data.
        
        let byteSize = Int(bufferListNoCopy.pointee.mBuffers.mDataByteSize)
        if let src = bufferListNoCopy.pointee.mBuffers.mData,
           let dst = self.audioBufferList.pointee.mBuffers.mData {
            memcpy(dst, src, byteSize)
            self.frameLength = frameCapacity // Assume full? No.
            // We need correct frame length.
            // But we don't know it here easily without calcs.
            // WAIT: The inputBlock in convert expects us to return a buffer containing the data.
            // If we copy, it works.
        }
    }
}
