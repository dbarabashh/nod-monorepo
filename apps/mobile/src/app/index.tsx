import { MeetingsView } from '../features/meetings/index.ts';
import { RecordBar } from '../features/recording/index.ts';

export default function MeetingsScreen() {
  return <MeetingsView bottomBar={<RecordBar />} />;
}
