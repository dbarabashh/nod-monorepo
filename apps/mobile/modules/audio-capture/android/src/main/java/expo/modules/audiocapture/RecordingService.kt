package expo.modules.audiocapture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

private const val CHANNEL = "recording"
private const val NOTIFICATION = 1

// Android stops a background app's microphone, so recording runs with a
// foreground service and the notification the system requires to show it.
class RecordingService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, "Recording", NotificationManager.IMPORTANCE_LOW)
    )
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = Notification.Builder(this, CHANNEL)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("Nod is recording")
      .setContentText("Transcribing on this phone. Audio is never stored.")
      .setOngoing(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIFICATION, notification)
    }
    return START_NOT_STICKY
  }
}
