import Foundation
import AudioToolbox
import CoreAudio

final class HALSystemAudioCapture {

    enum CaptureError: Error {
        case deviceNotFound
        case audioUnitInitFailed
        case streamFormatFailed
    }

    // MARK: - Public API

    var onAudioData: ((Data) -> Void)?

    fileprivate var audioUnit: AudioUnit?
    private var deviceID: AudioDeviceID = 0

    private let sampleRate: Double = 16_000
    private let bytesPerSample: UInt32 = 2

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

        // Stream format: 16kHz mono int16
        // Set on Output Scope, Bus 1 (Output of the AU's Input Bus)
        var format = AudioStreamBasicDescription(
            mSampleRate: sampleRate,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
            mBytesPerPacket: bytesPerSample,
            mFramesPerPacket: 1,
            mBytesPerFrame: bytesPerSample,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 16,
            mReserved: 0
        )

        let formatStatus = AudioUnitSetProperty(
            audioUnit,
            kAudioUnitProperty_StreamFormat,
            kAudioUnitScope_Output,
            1, // Element 1 (Input Bus) Output Format
            &format,
            UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        )

        guard formatStatus == noErr else {
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

    let pcm = Data(bytes: data, count: Int(bufferList.mBuffers.mDataByteSize))

    if !pcm.isEmpty {
        capture.onAudioData?(pcm)
    }

    return noErr
}
