import { useLocalSearchParams } from 'expo-router';
import { SharedNoteView } from '../features/shared-notes/index.ts';

export default function SharedNoteScreen() {
  const { peer, id } = useLocalSearchParams<{ peer: string; id: string }>();
  return <SharedNoteView peer={peer} id={id} />;
}
