import AVFoundation
import ExpoModulesCore
import UIKit

// Hands the microphone to JavaScript as 16 kHz mono 16-bit PCM in small
// parts. Nothing is written anywhere: audio exists only in memory, on its way
// to the transcriber.
public class AudioCaptureModule: Module {
  private let engine = AVAudioEngine()
  private let target = AVAudioFormat(
    commonFormat: .pcmFormatInt16,
    sampleRate: 16_000,
    channels: 1,
    interleaved: true
  )
  private var running = false
  private var finishing: UIBackgroundTaskIdentifier = .invalid
  private var observers: [NSObjectProtocol] = []

  public func definition() -> ModuleDefinition {
    Name("AudioCapture")

    Events("onAudio", "onInterruption")

    Function("permission") { () -> String in
      switch AVAudioSession.sharedInstance().recordPermission {
      case .granted: return "granted"
      case .denied: return "denied"
      default: return "undetermined"
      }
    }

    AsyncFunction("requestPermission") { (promise: Promise) in
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        promise.resolve(["granted": granted])
      }
    }

    // Recording on iOS needs no notification; Android asks for one.
    AsyncFunction("requestNotifications") { () -> [String: Bool] in
      ["granted": true]
    }

    // On the main queue, with the session notifications, so the engine is
    // only ever started, restarted and stopped from one place.
    AsyncFunction("start") {
      try self.start()
    }.runOnQueue(.main)

    // The leave to run is asked for before the session goes inactive, so the
    // app is never suspended in between.
    AsyncFunction("stop") {
      self.holdBackground()
      self.stop()
    }.runOnQueue(.main)

    AsyncFunction("release") {
      self.releaseBackground()
    }.runOnQueue(.main)

    OnDestroy {
      self.stop()
      self.releaseBackground()
    }
  }

  private func start() throws {
    if running {
      return
    }
    let session = AVAudioSession.sharedInstance()
    // With the audio background mode, recording goes on with the screen
    // locked or another app in front, for as long as the engine runs.
    try session.setCategory(.record, mode: .measurement, options: [.allowBluetoothHFP])
    try session.setActive(true)
    do {
      try startEngine()
    } catch {
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
      throw error
    }
    running = true
    observe()
  }

  // The tap runs on its own thread; it gets its converter here rather than
  // reading one the main queue may be replacing.
  private func startEngine() throws {
    engine.stop()
    let input = engine.inputNode
    input.removeTap(onBus: 0)
    let format = input.outputFormat(forBus: 0)
    guard let target, let converter = AVAudioConverter(from: format, to: target) else {
      throw CaptureFailed("This microphone's audio format can't be used")
    }
    input.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
      self?.send(buffer, through: converter, to: target)
    }
    engine.prepare()
    try engine.start()
  }

  private func send(
    _ buffer: AVAudioPCMBuffer,
    through converter: AVAudioConverter,
    to target: AVAudioFormat
  ) {
    let ratio = target.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
    guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else {
      return
    }
    var supplied = false
    var failure: NSError?
    converter.convert(to: out, error: &failure) { _, status in
      if supplied {
        status.pointee = .noDataNow
        return nil
      }
      supplied = true
      status.pointee = .haveData
      return buffer
    }
    guard failure == nil, out.frameLength > 0, let samples = out.int16ChannelData?[0] else {
      return
    }
    let data = Data(bytes: samples, count: Int(out.frameLength) * MemoryLayout<Int16>.size)
    sendEvent("onAudio", ["pcm": data.base64EncodedString()])
  }

  // A call takes the microphone away; recording picks up again when the
  // system gives it back. A new route (headphones) brings a new format.
  private func observe() {
    let center = NotificationCenter.default
    observers.append(center.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: nil,
      queue: .main
    ) { [weak self] note in
      guard let self, self.running,
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw) else {
        return
      }
      if type == .began {
        self.sendEvent("onInterruption", ["state": "began"])
      } else {
        try? AVAudioSession.sharedInstance().setActive(true)
        let resumed = (try? self.startEngine()) != nil
        self.sendEvent("onInterruption", ["state": resumed ? "ended" : "lost"])
      }
    })
    observers.append(center.addObserver(
      forName: .AVAudioEngineConfigurationChange,
      object: engine,
      queue: .main
    ) { [weak self] _ in
      guard let self, self.running else {
        return
      }
      if (try? self.startEngine()) == nil {
        self.sendEvent("onInterruption", ["state": "lost"])
      }
    })
  }

  // The audio background mode ends with the microphone, but the end of the
  // recording is still being transcribed; the app asks for the time to save
  // it, and gives it back in release().
  private func holdBackground() {
    guard finishing == .invalid else {
      return
    }
    finishing = UIApplication.shared.beginBackgroundTask(withName: "Finishing the transcript") {
      [weak self] in
      self?.releaseBackground()
    }
  }

  private func releaseBackground() {
    guard finishing != .invalid else {
      return
    }
    UIApplication.shared.endBackgroundTask(finishing)
    finishing = .invalid
  }

  private func stop() {
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers = []
    if running {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    running = false
  }
}

final class CaptureFailed: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    param
  }
}
