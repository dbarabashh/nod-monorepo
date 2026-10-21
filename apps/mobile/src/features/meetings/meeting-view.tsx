import { ScrollView, View } from 'react-native';
import { meetingName, meetingStartedAt, recordedMs } from '@nod/core/meetings';
import { EmptyState, Text } from '../../components/ui/index.ts';
import { useMeeting } from '../../lib/sync/sync.ts';
import { space, themed, useScheme } from '../../theme/index.ts';
import { formatDuration } from './lib/format-duration.ts';
import { longDateTimeFormat } from '../../lib/formats.ts';

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { gap: space[6], padding: space[4] },
  section: { gap: space[2] },
  line: { gap: space[0.5] },
}));

export function MeetingView({ id }: { id: string }) {
  const styles = sheets[useScheme()];
  const meeting = useMeeting(id);

  if (!meeting) {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="document"
          title="Meeting not found"
          description="It may have been deleted on another device."
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.section}>
        <Text variant="xl" accessibilityRole="header" selectable>
          {meetingName(meeting)}
        </Text>
        <Text tone="muted">
          {`${longDateTimeFormat.format(meetingStartedAt(meeting))} · ${formatDuration(recordedMs(meeting) / 1000)}`}
        </Text>
      </View>
      {meeting.summary !== null && meeting.summary !== '' && (
        <View style={styles.section}>
          <Text variant="lg" weight="semibold" accessibilityRole="header">
            Summary
          </Text>
          <Text selectable>{meeting.summary}</Text>
        </View>
      )}
      <View style={styles.section}>
        <Text variant="lg" weight="semibold" accessibilityRole="header">
          Transcript
        </Text>
        {meeting.transcript.length === 0 ? (
          <Text tone="muted">Nothing was transcribed yet.</Text>
        ) : (
          meeting.transcript.map((line) => (
            <View key={line.id} style={styles.line}>
              <Text variant="sm" tone="muted" weight="medium">
                {line.speaker === 'me' ? 'Me' : 'Others'}
              </Text>
              <Text selectable>{line.text}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}
