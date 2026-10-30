import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { SharedNoteDetail } from '@nod/core/sharing';
import {
  Button,
  EmptyState,
  Field,
  Input,
  Text,
} from '../../components/ui/index.ts';
import { longDateTimeFormat } from '../../lib/formats.ts';
import { messageOf } from '../../lib/message-of.ts';
import {
  deleteSharedNote,
  editSharedNote,
  getSharedNote,
  useSync,
} from '../../lib/sync/sync.ts';
import { space, themed, useScheme } from '../../theme/index.ts';
import { isReaderIn, shareOrigin } from './lib/share-origin.ts';

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { gap: space[6], padding: space[4] },
  section: { gap: space[2] },
}));

// One shared note: everyone it is shared with can edit the summary, and
// their edits merge; a team's readers only read. The text is saved when
// editing ends, so a half-typed sentence never races an edit arriving from
// another device.
export function SharedNoteView({ target, id }: { target: string; id: string }) {
  const styles = sheets[useScheme()];
  const router = useRouter();
  const sync = useSync();
  const [note, setNote] = useState<SharedNoteDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<{ text: string; from: string } | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  const sharing = sync.status === 'ready' ? sync.sharing : null;
  const listed =
    sharing?.status === 'ready'
      ? sharing.notes.find(
          (entry) => entry.target === target && entry.id === id,
        )
      : undefined;
  const readOnly =
    sharing?.status === 'ready' && isReaderIn(sharing.teams, target);

  useEffect(() => {
    let active = true;
    getSharedNote(target, id).then(
      (loaded) => {
        if (active) {
          setNote(loaded);
          setMissing(false);
        }
      },
      () => active && setMissing(true),
    );
    return () => {
      active = false;
    };
    // The list carries no summary, so the note is read again after every
    // sync change: a lookup on this device, which shows an edit from
    // another device while the note is open.
  }, [target, id, sharing]);

  if (missing || !listed) {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="document"
          title="Note not found"
          description="It may have been deleted, or you no longer have access to it."
        />
      </View>
    );
  }

  const save = () => {
    if (draft === null || !note || draft.text === note.summary) {
      setDraft(null);
      return;
    }
    setFailed(null);
    const sent = draft.text;
    editSharedNote(target, id, sent, draft.from).then(
      (saved) =>
        setDraft((current) =>
          current === null || current.text === sent
            ? null
            : { text: current.text, from: saved },
        ),
      (failure: unknown) => setFailed(messageOf(failure)),
    );
  };

  const confirmDelete = () =>
    Alert.alert(
      'Delete this shared note?',
      'It is deleted for everyone it is shared with, on every device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteSharedNote(target, id).then(
              () => router.back(),
              (failure: unknown) =>
                Alert.alert('Couldn’t delete the note', messageOf(failure)),
            );
          },
        },
      ],
    );

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <Text variant="xl" accessibilityRole="header" selectable>
            {listed.title}
          </Text>
          <Text tone="muted">
            {`${shareOrigin(listed)} · ${longDateTimeFormat.format(listed.sharedAt)}`}
          </Text>
        </View>
        <Field
          label="Summary"
          hint={
            readOnly
              ? 'You can read this team’s notes but not change them.'
              : undefined
          }
          error={failed ?? undefined}
        >
          <Input
            multiline
            value={draft?.text ?? note?.summary ?? ''}
            editable={note !== null && !readOnly}
            onChangeText={(text) =>
              setDraft((current) =>
                current
                  ? { ...current, text }
                  : note
                    ? { text, from: note.version }
                    : null,
              )
            }
            onBlur={save}
          />
        </Field>
        {!readOnly && (
          <View style={styles.section}>
            <Button variant="ghost" icon="trash" onPress={confirmDelete}>
              Delete note
            </Button>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
