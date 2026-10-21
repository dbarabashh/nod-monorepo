import { Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, Text } from '../../../components/ui/index.ts';
import { formatClock } from '../../../lib/format-clock.ts';
import {
  finishPaused,
  finishRecording,
  pauseRecording,
  useRecorder,
} from '../../../lib/recording/recording.ts';
import { meetingRecording } from '../../../lib/recording/status.ts';
import { useMeeting } from '../../../lib/sync/sync.ts';
import { size, space, themed, useScheme } from '../../../theme/index.ts';
import { useElapsed } from '../hooks/use-elapsed.ts';
import { useNow } from '../hooks/use-now.ts';
import { useRecordingStart } from '../hooks/use-recording-start.ts';

const sheets = themed((colors) => ({
  dock: {
    gap: space[2],
    paddingTop: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: size.borderWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  grow: { flex: 1 },
}));

// A meeting's dock, as on the computer: pause and finish while it records,
// resume and finish once paused. A meeting another device is recording is
// left to that device.
export function MeetingRecordingActions({ meetingId }: { meetingId: string }) {
  const styles = sheets[useScheme()];
  const insets = useSafeAreaInsets();
  const meeting = useMeeting(meetingId);
  const recorder = useRecorder();
  const elapsed = useElapsed(recorder);
  const now = useNow(5_000);
  const { resume, starting, error, blocked } = useRecordingStart();
  if (!meeting) {
    return null;
  }
  const status = meetingRecording(meeting, recorder, now);
  if (status === 'finished') {
    return null;
  }
  const busyElsewhere =
    recorder.status === 'recording' && recorder.meetingId !== meetingId;
  const problem = error ?? (status === 'recording' ? recorder.problem : null);

  return (
    <View style={[styles.dock, { paddingBottom: insets.bottom + space[3] }]}>
      {problem !== null && (
        <Text variant="sm" tone="danger" accessibilityLiveRegion="assertive">
          {problem}
        </Text>
      )}
      {blocked && (
        <Button variant="outline" onPress={() => void Linking.openSettings()}>
          Open Settings
        </Button>
      )}
      <View style={styles.row}>
        {status === 'elsewhere' ? (
          <Badge variant="danger" dot>
            Recording on another device
          </Badge>
        ) : status === 'recording' ? (
          <>
            <Button
              variant="outline"
              icon="mic"
              style={styles.grow}
              onPress={() => void pauseRecording()}
            >
              {`${recorder.status === 'recording' && recorder.interrupted ? 'Paused by a call' : 'Pause'} · ${formatClock(elapsed)}`}
            </Button>
            <Button
              variant="danger"
              style={styles.grow}
              onPress={() => void finishRecording()}
            >
              Finish
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="default"
              icon="mic"
              style={styles.grow}
              disabled={starting || busyElsewhere}
              onPress={() => resume(meetingId)}
            >
              {starting ? 'Starting…' : 'Resume'}
            </Button>
            <Button
              variant="ghost"
              style={styles.grow}
              disabled={busyElsewhere}
              onPress={() => void finishPaused(meetingId)}
            >
              Finish
            </Button>
          </>
        )}
      </View>
    </View>
  );
}
