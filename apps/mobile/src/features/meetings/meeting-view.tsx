import { useState, type ReactNode } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  meetingName,
  meetingStartedAt,
  recordedMs,
  type Meeting,
} from '@nod/core/meetings';
import { Button, EmptyState, Tabs, Text } from '../../components/ui/index.ts';
import { formatClock } from '../../lib/format-clock.ts';
import { longDateTimeFormat } from '../../lib/formats.ts';
import { messageOf } from '../../lib/message-of.ts';
import { useRecorder, useTranscribing } from '../../lib/recording/recording.ts';
import { deleteMeeting, useMeeting } from '../../lib/sync/sync.ts';
import { dock, space, themed, useScheme } from '../../theme/index.ts';
import { formatDuration } from './lib/format-duration.ts';

type Tab = 'summary' | 'transcript';

const tabs: { value: Tab; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'transcript', label: 'Transcript' },
];

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { gap: space[6], padding: space[4] },
  section: { gap: space[2] },
  lines: { gap: space[4] },
  line: { gap: space[0.5] },
  speaker: { flexDirection: 'row', gap: space[2] },
}));

function Summary({ meeting }: { meeting: Meeting }) {
  const styles = sheets[useScheme()];
  return (
    <View style={styles.section}>
      {meeting.summary ? (
        <>
          {meeting.summaryEdited && (
            <Text variant="sm" tone="muted">
              Edited
            </Text>
          )}
          <Text selectable>{meeting.summary}</Text>
        </>
      ) : (
        <Text tone="muted">
          {meeting.finishedAt === null
            ? 'Your computer writes the summary and name once the meeting is finished.'
            : 'No summary yet. Your computer writes it and names the meeting about a minute after this meeting reaches it, if it has a summary model.'}
        </Text>
      )}
    </View>
  );
}

function Transcript({
  meeting,
  recording,
}: {
  meeting: Meeting;
  recording: boolean;
}) {
  const styles = sheets[useScheme()];
  const transcribing = useTranscribing(meeting.id);
  const note = transcribing
    ? 'Transcribing the end of the recording…'
    : recording
      ? 'Lines show up a few seconds after they are spoken.'
      : null;
  if (meeting.transcript.length === 0) {
    return (
      <Text tone="muted" accessibilityLiveRegion="polite">
        {note ?? 'Nothing was transcribed yet.'}
      </Text>
    );
  }
  return (
    <View style={styles.lines}>
      {meeting.transcript.map((line) => {
        const speaker = line.speaker === 'me' ? 'Me' : 'Others';
        const time = formatClock(line.startMs);
        return (
          <View
            key={line.id}
            style={styles.line}
            accessible
            accessibilityLabel={`${speaker} at ${time}: ${line.text}`}
          >
            <View style={styles.speaker}>
              <Text variant="sm" weight="semibold">
                {speaker}
              </Text>
              <Text variant="sm" tone="muted">
                {time}
              </Text>
            </View>
            <Text selectable>{line.text}</Text>
          </View>
        );
      })}
      {note !== null && (
        <Text variant="sm" tone="muted" accessibilityLiveRegion="polite">
          {note}
        </Text>
      )}
    </View>
  );
}

// As on the computer: the summary and the transcript in two tabs, opening
// on the summary when there is one. The recording dock comes from the route.
export function MeetingView({
  id,
  actions,
}: {
  id: string;
  actions?: ReactNode;
}) {
  const styles = sheets[useScheme()];
  const meeting = useMeeting(id);
  const router = useRouter();
  const recorder = useRecorder();
  const insets = useSafeAreaInsets();
  const recordingThis =
    recorder.status === 'recording' && recorder.meetingId === id;
  const [chosen, setChosen] = useState<Tab | null>(null);

  if (!meeting) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerRight: undefined }} />
        <EmptyState
          icon="document"
          title="Meeting not found"
          description="It may have been deleted on another device."
        />
      </View>
    );
  }
  const tab = chosen ?? (meeting.summary ? 'summary' : 'transcript');

  const confirmDelete = () =>
    Alert.alert(
      'Delete this meeting?',
      'It is deleted on this phone and on your other devices, with its transcript and summary.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteMeeting(id).then(
              () => router.back(),
              (failure: unknown) =>
                Alert.alert('Couldn’t delete the meeting', messageOf(failure)),
            );
          },
        },
      ],
    );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Button
              variant="ghost"
              size="sm"
              icon="trash"
              accessibilityLabel="Delete meeting"
              accessibilityHint={
                recordingThis
                  ? 'Pause and finish the recording first'
                  : undefined
              }
              disabled={recordingThis}
              onPress={confirmDelete}
            />
          ),
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          actions !== undefined &&
            meeting.finishedAt === null && {
              paddingBottom: dock.room + insets.bottom,
            },
        ]}
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
        <Tabs tabs={tabs} value={tab} onChange={setChosen} />
        {tab === 'summary' ? (
          <Summary meeting={meeting} />
        ) : (
          <Transcript meeting={meeting} recording={recordingThis} />
        )}
      </ScrollView>
      {actions}
    </View>
  );
}
