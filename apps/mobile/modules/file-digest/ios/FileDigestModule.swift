import CryptoKit
import ExpoModulesCore

// Model files are hundreds of megabytes; hashing them in JavaScript would
// freeze the app, so it is done here, a few megabytes at a time.
public class FileDigestModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FileDigest")

    AsyncFunction("sha256") { (uri: String) -> String in
      guard let url = URL(string: uri), url.isFileURL else {
        throw DigestFailed("Only a file on this device can be checked")
      }
      let handle = try FileHandle(forReadingFrom: url)
      defer { try? handle.close() }
      var hash = SHA256()
      while let part = try handle.read(upToCount: 4 * 1024 * 1024), !part.isEmpty {
        hash.update(data: part)
      }
      return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
  }
}

final class DigestFailed: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    param
  }
}
