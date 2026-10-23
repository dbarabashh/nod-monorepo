import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { EmptyState, ListRow, Text } from '../../components/ui/index.ts';
import { dateTimeFormat } from '../../lib/formats.ts';
import { syncNow, useSync } from '../../lib/sync/sync.ts';
import { space, themed, useColors, useScheme } from '../../theme/index.ts';

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  content: { flexGrow: 1, gap: space[1], padding: space[4] },
  header: { gap: space[2], paddingBottom: space[3] },
}));

// Notes shared with this person, from every one-to-one vault. Sharing a
// meeting and adding people happen on the computer; the phone reads and
// edits what arrives.
export function SharedNotesView() {
  const styles = sheets[useScheme()];
  const colors = useColors();
  const router = useRouter();
  const sync = useSync();
  const [refreshing, setRefreshing] = useState(false);

  if (sync.status !== 'ready' || sync.sharing.status !== 'ready') {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="document"
          title="No shared notes"
          description="Pair this phone with your computer first. Notes you share there, and notes others share with you, show up here."
        />
      </View>
    );
  }
  const sharing = sync.sharing;

  const refresh = () => {
    setRefreshing(true);
    void syncNow().finally(() => setRefreshing(false));
  };

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        data={sharing.notes}
        keyExtractor={(note) => `${note.peer}:${note.id}`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textMuted}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={
          sharing.error !== null ? (
            <View style={styles.header}>
              <Text variant="sm" tone="danger" accessibilityLiveRegion="polite">
                {sharing.error}
              </Text>
            </View>
          ) : undefined
        }
        ListEmptyComponent={
          <EmptyState
            icon="document"
            title="No shared notes yet"
            description="On your computer, open a meeting and choose “Share with…”. Notes others share with you show up here too."
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.title}
            meta={`With ${item.peerCode} · ${dateTimeFormat.format(item.sharedAt)}`}
            accessibilityHint="Opens the shared note"
            onPress={() =>
              router.push({
                pathname: '/shared-note',
                params: { peer: item.peer, id: item.id },
              })
            }
          />
        )}
      />
    </View>
  );
}
