import { useLocalSearchParams } from 'expo-router';
import { MeetingView } from '../../features/meetings/index.ts';

export default function MeetingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MeetingView id={id} />;
}
