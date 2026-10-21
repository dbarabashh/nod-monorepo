import { useLocalSearchParams } from 'expo-router';
import { MeetingView } from '../../features/meetings/index.ts';
import { MeetingRecordingActions } from '../../features/recording/index.ts';

export default function MeetingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <MeetingView id={id} actions={<MeetingRecordingActions meetingId={id} />} />
  );
}
