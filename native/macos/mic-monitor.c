#include <CoreAudio/CoreAudio.h>
#include <dispatch/dispatch.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_PROCESSES 1024
#define MAX_DEVICES 256

static dispatch_queue_t queue;
static AudioObjectID watched[MAX_DEVICES];
static int watchedCount = 0;
static char lastLine[16384] = "";
// Before macOS 14.4 CoreAudio can't say which process records, only that an
// input device is in use.
static int namesProcesses = 0;

static AudioObjectPropertyAddress address(AudioObjectPropertySelector selector) {
  AudioObjectPropertyAddress result = {selector, kAudioObjectPropertyScopeGlobal,
                                       kAudioObjectPropertyElementMain};
  return result;
}

// The app reads one line per change: "idle", or "active" followed by
// "pid:bundle-id" for each recording process ("active" alone when the system
// can't say which).
static void emit(const char *line) {
  if (strcmp(line, lastLine) == 0) {
    return;
  }
  strncpy(lastLine, line, sizeof(lastLine) - 1);
  printf("%s\n", line);
  fflush(stdout);
}

static int processList(AudioObjectID *processes, int capacity) {
  AudioObjectPropertyAddress list = address(kAudioHardwarePropertyProcessObjectList);
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &list, 0, NULL, &size) != noErr) {
    return 0;
  }
  UInt32 count = size / sizeof(AudioObjectID);
  if (count > (UInt32)capacity) {
    count = (UInt32)capacity;
  }
  size = count * sizeof(AudioObjectID);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &list, 0, NULL, &size, processes) != noErr) {
    return 0;
  }
  return (int)(size / sizeof(AudioObjectID));
}

static int hasInput(AudioObjectID device) {
  AudioObjectPropertyAddress streams = {kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput,
                                        kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  return AudioObjectGetPropertyDataSize(device, &streams, 0, NULL, &size) == noErr && size > 0;
}

static int isWatched(AudioObjectID device) {
  for (int i = 0; i < watchedCount; i++) {
    if (watched[i] == device) {
      return 1;
    }
  }
  return 0;
}

static int anyInputRunning(void) {
  AudioObjectPropertyAddress somewhere = address(kAudioDevicePropertyDeviceIsRunningSomewhere);
  for (int i = 0; i < watchedCount; i++) {
    UInt32 running = 0;
    UInt32 size = sizeof(running);
    if (hasInput(watched[i]) &&
        AudioObjectGetPropertyData(watched[i], &somewhere, 0, NULL, &size, &running) == noErr &&
        running) {
      return 1;
    }
  }
  return 0;
}

static void report(void) {
  if (!namesProcesses) {
    emit(anyInputRunning() ? "active" : "idle");
    return;
  }
  AudioObjectID processes[MAX_PROCESSES];
  int count = processList(processes, MAX_PROCESSES);
  char line[sizeof(lastLine)] = "active";
  int active = 0;
  for (int i = 0; i < count; i++) {
    UInt32 running = 0;
    UInt32 size = sizeof(running);
    AudioObjectPropertyAddress input = address(kAudioProcessPropertyIsRunningInput);
    if (AudioObjectGetPropertyData(processes[i], &input, 0, NULL, &size, &running) != noErr ||
        !running) {
      continue;
    }
    pid_t pid = 0;
    size = sizeof(pid);
    AudioObjectPropertyAddress pidAddress = address(kAudioProcessPropertyPID);
    AudioObjectGetPropertyData(processes[i], &pidAddress, 0, NULL, &size, &pid);
    char bundle[256] = "";
    CFStringRef bundleId = NULL;
    size = sizeof(CFStringRef);
    AudioObjectPropertyAddress bundleAddress = address(kAudioProcessPropertyBundleID);
    if (AudioObjectGetPropertyData(processes[i], &bundleAddress, 0, NULL, &size, &bundleId) ==
            noErr &&
        bundleId != NULL) {
      CFStringGetCString(bundleId, bundle, sizeof(bundle), kCFStringEncodingUTF8);
      CFRelease(bundleId);
    }
    for (char *c = bundle; *c; c++) {
      if (*c == ' ' || *c == '\n') {
        *c = '_';
      }
    }
    char entry[300];
    snprintf(entry, sizeof(entry), " %d:%s", (int)pid, bundle);
    if (strlen(line) + strlen(entry) < sizeof(line)) {
      strcat(line, entry);
    }
    active = 1;
  }
  emit(active ? line : "idle");
}

static int polling = 0;

// Processes don't announce when they start recording, and a device that is
// already playing (a headset) doesn't announce a second app using it, so
// while any input device runs the processes are read again every second.
// With every device idle, nothing runs.
static void poll(void) {
  report();
  if (anyInputRunning()) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), queue, ^{
      poll();
    });
  } else {
    polling = 0;
  }
}

static void deviceChanged(void) {
  report();
  if (!polling) {
    polling = 1;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 2), queue, ^{
      poll();
    });
  }
}

static void watchDevices(void) {
  AudioObjectPropertyAddress list = address(kAudioHardwarePropertyDevices);
  AudioObjectID devices[MAX_DEVICES];
  UInt32 size = sizeof(devices);
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &list, 0, NULL, &size, devices) !=
      noErr) {
    return;
  }
  AudioObjectPropertyAddress somewhere = address(kAudioDevicePropertyDeviceIsRunningSomewhere);
  int count = (int)(size / sizeof(AudioObjectID));
  for (int i = 0; i < count && watchedCount < MAX_DEVICES; i++) {
    if (isWatched(devices[i])) {
      continue;
    }
    if (AudioObjectAddPropertyListenerBlock(devices[i], &somewhere, queue,
                                            ^(UInt32 n, const AudioObjectPropertyAddress *a) {
                                              (void)n;
                                              (void)a;
                                              deviceChanged();
                                            }) == noErr) {
      watched[watchedCount++] = devices[i];
    }
  }
}

int main(void) {
  queue = dispatch_queue_create("mic-monitor", DISPATCH_QUEUE_SERIAL);

  // The app keeps stdin open; when it closes, the app is gone, so this never
  // outlives it.
  dispatch_source_t input =
      dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, STDIN_FILENO, 0, queue);
  dispatch_source_set_event_handler(input, ^{
    char buffer[256];
    if (read(STDIN_FILENO, buffer, sizeof(buffer)) <= 0) {
      exit(0);
    }
  });
  dispatch_resume(input);

  // This process runs no main run loop, so CoreAudio is told to deliver
  // change notifications on a thread of its own; otherwise none arrive.
  CFRunLoopRef runLoop = NULL;
  AudioObjectPropertyAddress runLoopAddress = address(kAudioHardwarePropertyRunLoop);
  AudioObjectSetPropertyData(kAudioObjectSystemObject, &runLoopAddress, 0, NULL,
                             sizeof(CFRunLoopRef), &runLoop);

  AudioObjectPropertyAddress processes = address(kAudioHardwarePropertyProcessObjectList);
  namesProcesses = AudioObjectHasProperty(kAudioObjectSystemObject, &processes);

  dispatch_async(queue, ^{
    AudioObjectPropertyAddress list = address(kAudioHardwarePropertyDevices);
    AudioObjectAddPropertyListenerBlock(kAudioObjectSystemObject, &list, queue,
                                        ^(UInt32 n, const AudioObjectPropertyAddress *a) {
                                          (void)n;
                                          (void)a;
                                          watchDevices();
                                          deviceChanged();
                                        });
    watchDevices();
    deviceChanged();
  });

  dispatch_main();
}
