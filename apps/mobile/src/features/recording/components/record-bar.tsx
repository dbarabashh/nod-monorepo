import { Linking, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text } from '../../../components/ui/index.ts';
import { formatClock } from '../../../lib/format-clock.ts';
import {
  finishRecording,
  pauseRecording,
  useRecorder,
} from '../../../lib/recording/recording.ts';
import { size, space, themed, useScheme } from '../../../theme/index.ts';
import { useElapsed } from '../hooks/use-elapsed.ts';
import { useRecordingStart } from '../hooks/use-recording-start.ts';

const sheets = themed((colors) => ({
  bar: {
    gap: space[2],
    paddingTop: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: size.borderWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  row: { flexDirection: 'row', gap: space[2] },
  grow: { flex: 1 },
}));

// The meetings list's dock, as on the computer: a new recording, or pause
// and finish for the one going on.
export function RecordBar() {
  const styles = sheets[useScheme()];
  const insets = useSafeAreaInsets();
  const recorder = useRecorder();
  const elapsed = useElapsed(recorder);
  const { start, resume, starting, error, blocked } = useRecordingStart();
  const problem = error ?? recorder.problem;

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + space[3] }]}>
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
        {recorder.status === 'recording' ? (
          <>
            <Button
              variant="outline"
              icon="mic"
              style={styles.grow}
              accessibilityLabel={`Pause recording, ${formatClock(elapsed)} recorded`}
              onPress={() => void pauseRecording()}
            >
              {`${recorder.interrupted ? 'Paused by a call' : 'Pause'} · ${formatClock(elapsed)}`}
            </Button>
            <Button
              variant="danger"
              style={styles.grow}
              onPress={() => void finishRecording()}
            >
              Finish
            </Button>
          </>
        ) : recorder.status === 'paused' ? (
          <>
            <Button
              variant="default"
              icon="mic"
              style={styles.grow}
              disabled={starting}
              onPress={() => resume(recorder.meetingId)}
            >
              {starting ? 'Starting…' : 'Resume'}
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
          <Button
            variant="default"
            icon="plus"
            style={styles.grow}
            disabled={starting}
            onPress={start}
          >
            {starting ? 'Starting…' : 'New recording'}
          </Button>
        )}
      </View>
    </View>
  );
}
