import { useLocalSearchParams } from 'expo-router';
import { SharedNoteView } from '../features/shared-notes/index.ts';

export default function SharedNoteScreen() {
  const { target, id } = useLocalSearchParams<{ target: string; id: string }>();
  return <SharedNoteView target={target} id={id} />;
}
