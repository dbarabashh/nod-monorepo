package expo.modules.filedigest

import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.security.MessageDigest

// Model files are hundreds of megabytes; hashing them in JavaScript would
// freeze the app, so it is done here, a few megabytes at a time.
class FileDigestModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FileDigest")

    AsyncFunction("sha256") { uri: String ->
      val parsed = Uri.parse(uri)
      val path = parsed.path
      if (parsed.scheme != "file" || path == null) {
        throw CodedException("ERR_DIGEST", "Only a file on this device can be checked", null)
      }
      val digest = MessageDigest.getInstance("SHA-256")
      File(path).inputStream().use { input ->
        val part = ByteArray(4 * 1024 * 1024)
        while (true) {
          val read = input.read(part)
          if (read < 0) {
            break
          }
          digest.update(part, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }
  }
}
