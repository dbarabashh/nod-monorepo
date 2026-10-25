package expo.modules.qrscanner

import android.content.Context
import android.view.View
import android.view.ViewGroup
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.NotFoundException
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// The back camera's preview, with each frame's brightness read for a QR code
// in memory. Frames are never saved: the code carries a pairing secret.
class QrScannerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onScan by EventDispatcher()
  private val onError by EventDispatcher()
  private val preview = PreviewView(context).apply {
    // A SurfaceView ignores the rounded corners the screen clips it to.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }

  // One run of the camera, from attach to detach. Each run has its own thread
  // and reader, so a frame still decoding after a detach can't share them.
  private class Session(val executor: ExecutorService) {
    val reader = MultiFormatReader().apply {
      setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)))
    }
    var provider: ProcessCameraProvider? = null
    var bound: Array<UseCase> = emptyArray()
    var lastSent: String? = null
  }

  private var session: Session? = null

  init {
    // React Native's views swallow requestLayout, so the surface PreviewView
    // adds once the camera starts would stay 0×0 and the preview black.
    preview.setOnHierarchyChangeListener(object : OnHierarchyChangeListener {
      override fun onChildViewRemoved(parent: View?, child: View?) = Unit
      override fun onChildViewAdded(parent: View?, child: View?) {
        parent?.measure(
          MeasureSpec.makeMeasureSpec(measuredWidth, MeasureSpec.EXACTLY),
          MeasureSpec.makeMeasureSpec(measuredHeight, MeasureSpec.EXACTLY),
        )
        parent?.layout(0, 0, parent.measuredWidth, parent.measuredHeight)
      }
    })
    addView(preview, ViewGroup.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    measureChild(preview, widthMeasureSpec, heightMeasureSpec)
    setMeasuredDimension(
      ViewGroup.resolveSize(preview.measuredWidth, widthMeasureSpec),
      ViewGroup.resolveSize(preview.measuredHeight, heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    preview.layout(0, 0, right - left, bottom - top)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    start()
  }

  override fun onDetachedFromWindow() {
    stop()
    super.onDetachedFromWindow()
  }

  private fun start() {
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      onError(mapOf("message" to "The camera needs the app to be open."))
      return
    }
    val run = Session(Executors.newSingleThreadExecutor())
    session = run
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      if (session !== run) return@addListener
      // A phone without a usable back camera, a camera held by another app,
      // or an activity closing meanwhile: shown as an error, never a crash.
      try {
        val cameras = future.get()
        val selector = when {
          cameras.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) -> CameraSelector.DEFAULT_BACK_CAMERA
          cameras.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA) -> CameraSelector.DEFAULT_FRONT_CAMERA
          else -> throw IllegalStateException("No camera")
        }
        val shown = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
        val analysis = ImageAnalysis.Builder()
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()
        analysis.setAnalyzer(run.executor) { image -> decode(run, image) }
        cameras.bindToLifecycle(owner, selector, shown, analysis)
        run.provider = cameras
        run.bound = arrayOf(shown, analysis)
      } catch (failure: Exception) {
        onError(mapOf("message" to "The camera couldn't start."))
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun decode(run: Session, image: ImageProxy) {
    try {
      val plane = image.planes[0]
      val buffer = plane.buffer
      val luminance = ByteArray(buffer.remaining())
      buffer.get(luminance)
      val source = PlanarYUVLuminanceSource(
        luminance,
        plane.rowStride,
        image.height,
        0,
        0,
        image.width,
        image.height,
        false,
      )
      val text = run.reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text
      // The same code is in view for many frames; JS needs it once.
      if (text != run.lastSent) {
        run.lastSent = text
        post { if (session === run) onScan(mapOf("data" to text)) }
      }
    } catch (_: NotFoundException) {
    } catch (_: Exception) {
    } finally {
      run.reader.reset()
      image.close()
    }
  }

  private fun stop() {
    val run = session ?: return
    session = null
    run.provider?.unbind(*run.bound)
    run.executor.shutdown()
  }
}
