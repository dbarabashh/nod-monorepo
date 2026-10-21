package expo.modules.nodautomerge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NodAutomergeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NodAutomerge")

    Function("call") { request: String -> nativeCall(request) }
  }

  companion object {
    init {
      System.loadLibrary("nod_automerge")
    }

    @JvmStatic
    external fun nativeCall(request: String): String
  }
}
