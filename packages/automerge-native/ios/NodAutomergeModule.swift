import ExpoModulesCore

public class NodAutomergeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NodAutomerge")

    Function("call") { (request: String) -> String in
      let bytes = Array(request.utf8)
      var length = 0
      let reply = bytes.withUnsafeBufferPointer { buffer in
        nod_am_call(buffer.baseAddress, buffer.count, &length)
      }
      guard let reply else {
        return "{\"err\":\"the native Automerge backend returned nothing\"}"
      }
      defer { nod_am_free(reply, length) }
      return String(decoding: UnsafeBufferPointer(start: reply, count: length), as: UTF8.self)
    }
  }
}
