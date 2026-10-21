import ExpoModulesCore

public class BackupExclusionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BackupExclusion")

    // Resolves to whether the item is now excluded, read back from the file
    // system rather than assumed.
    AsyncFunction("exclude") { (uri: String) -> Bool in
      guard var url = URL(string: uri), url.isFileURL else {
        throw ExclusionFailed("Only a file on this device can be kept out of backups")
      }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try url.setResourceValues(values)
      url.removeAllCachedResourceValues()
      return try url.resourceValues(forKeys: [.isExcludedFromBackupKey]).isExcludedFromBackup ?? false
    }
  }
}

final class ExclusionFailed: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    param
  }
}
