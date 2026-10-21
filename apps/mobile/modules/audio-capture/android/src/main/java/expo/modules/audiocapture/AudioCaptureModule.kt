package expo.modules.audiocapture

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.ByteBuffer
import java.nio.ByteOrder

private const val SAMPLE_RATE = 16_000
// A tenth of a second per part, small enough that pausing loses little.
private const val PART_SAMPLES = SAMPLE_RATE / 10

// Hands the microphone to JavaScript as 16 kHz mono 16-bit PCM in small
// parts. Nothing is written anywhere: audio exists only in memory, on its way
// to the transcriber. A foreground service with a visible notification keeps
// the process alive while it records, and only then.
class AudioCaptureModule : Module() {
  private var recorder: AudioRecord? = null
  private var reader: Thread? = null
  @Volatile private var running = false

  private val context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val permissions: Permissions
    get() = appContext.permissions ?: throw Exceptions.PermissionsModuleNotFound()

  override fun definition() = ModuleDefinition {
    Name("AudioCapture")

    Events("onAudio", "onInterruption")

    Function("permission") {
      if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
        PackageManager.PERMISSION_GRANTED
      ) {
        "granted"
      } else {
        "undetermined"
      }
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(
        permissions,
        promise,
        Manifest.permission.RECORD_AUDIO
      )
    }

    // The foreground service must show its notification; from Android 13
    // that needs the user's consent, asked when they first record.
    AsyncFunction("requestNotifications") { promise: Promise ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        Permissions.askForPermissionsWithPermissionsManager(
          permissions,
          promise,
          Manifest.permission.POST_NOTIFICATIONS
        )
      } else {
        promise.resolve(mapOf("granted" to true))
      }
    }

    AsyncFunction("start") { start() }

    AsyncFunction("stop") { stop() }

    // The service outlives the microphone until the end of the recording is
    // transcribed and saved, so Android doesn't stop the app before that.
    AsyncFunction("release") { release() }

    OnDestroy {
      stop()
      release()
    }
  }

  private fun start() {
    if (running) {
      return
    }
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      throw CodedException("ERR_MICROPHONE", "Microphone access is off for Nod", null)
    }
    val minimum = AudioRecord.getMinBufferSize(
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    )
    val record = AudioRecord(
      MediaRecorder.AudioSource.VOICE_RECOGNITION,
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
      maxOf(minimum, PART_SAMPLES * 2 * 4)
    )
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      throw CodedException("ERR_MICROPHONE", "The microphone couldn't be opened", null)
    }
    // Only once the microphone opened, so the service is never stopped
    // before it could show its notification.
    try {
      ContextCompat.startForegroundService(context, Intent(context, RecordingService::class.java))
      record.startRecording()
    } catch (error: Exception) {
      record.release()
      throw error
    }
    recorder = record
    running = true
    reader = Thread {
      val samples = ShortArray(PART_SAMPLES)
      while (running) {
        val read = record.read(samples, 0, samples.size)
        if (read > 0) {
          val bytes = ByteBuffer.allocate(read * 2).order(ByteOrder.LITTLE_ENDIAN)
          bytes.asShortBuffer().put(samples, 0, read)
          sendEvent("onAudio", mapOf("pcm" to Base64.encodeToString(bytes.array(), Base64.NO_WRAP)))
        } else if (read < 0) {
          if (running) {
            running = false
            sendEvent("onInterruption", mapOf("state" to "lost"))
          }
          break
        }
      }
    }.apply { start() }
  }

  // Stopping the recorder first wakes a read that is waiting for audio, so
  // the reader ends before the recorder is released under it.
  private fun stop() {
    running = false
    recorder?.let {
      if (it.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
        it.stop()
      }
    }
    reader?.join(1_000)
    reader = null
    recorder?.release()
    recorder = null
  }

  private fun release() {
    if (running) {
      return
    }
    appContext.reactContext?.let {
      it.stopService(Intent(it, RecordingService::class.java))
    }
  }
}
