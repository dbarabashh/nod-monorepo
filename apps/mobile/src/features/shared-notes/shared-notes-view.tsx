import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { TeamInfo } from '@nod/core/sharing';
import {
  Badge,
  EmptyState,
  List,
  ListRow,
  Text,
  type BadgeVariant,
} from '../../components/ui/index.ts';
import { dateTimeFormat } from '../../lib/formats.ts';
import { syncNow, useSync } from '../../lib/sync/sync.ts';
import { space, themed, useColors, useScheme } from '../../theme/index.ts';
import { shareOrigin, teamStanding } from './lib/share-origin.ts';

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  content: { flexGrow: 1, gap: space[1], padding: space[4] },
  header: { gap: space[3], paddingBottom: space[3] },
  teams: { gap: space[1] },
  team: { gap: space[0.5] },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  teamName: { flexShrink: 1 },
}));

function standingVariant(team: TeamInfo): BadgeVariant {
  if (team.pending) {
    return 'warning';
  }
  return team.role === null && team.members.length > 0 ? 'danger' : 'default';
}

// Notes shared with this person, one to one and in their teams. Sharing a
// meeting, adding people and managing teams happen on the computer; the
// phone reads and edits what arrives.
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

  const header =
    sharing.error !== null || sharing.teams.length > 0 ? (
      <View style={styles.header}>
        {sharing.error !== null && (
          <Text variant="sm" tone="danger" accessibilityLiveRegion="polite">
            {sharing.error}
          </Text>
        )}
        {sharing.teams.length > 0 && (
          <View style={styles.teams}>
            <Text variant="sm" tone="muted" accessibilityRole="header">
              Your teams
            </Text>
            <List>
              {sharing.teams.map((team) => (
                <View
                  key={team.vaultId}
                  style={styles.team}
                  accessible
                  accessibilityLabel={`${team.name}, ${teamStanding(team)}${team.error === null ? '' : `. ${team.error}`}`}
                >
                  <View style={styles.teamRow}>
                    <Text numberOfLines={1} style={styles.teamName}>
                      {team.name}
                    </Text>
                    <Badge variant={standingVariant(team)}>
                      {teamStanding(team)}
                    </Badge>
                  </View>
                  {team.error !== null && (
                    <Text variant="sm" tone="danger">
                      {team.error}
                    </Text>
                  )}
                </View>
              ))}
            </List>
          </View>
        )}
      </View>
    ) : undefined;

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        data={sharing.notes}
        keyExtractor={(note) => `${note.target}:${note.id}`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textMuted}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={
          <EmptyState
            icon="document"
            title="No shared notes yet"
            description="On your computer, open a meeting and choose “Share with…”. Notes others share with you, and your teams’ notes, show up here too."
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.title}
            meta={`${shareOrigin(item)} · ${dateTimeFormat.format(item.sharedAt)}`}
            accessibilityHint="Opens the shared note"
            onPress={() =>
              router.push({
                pathname: '/shared-note',
                params: { target: item.target, id: item.id },
              })
            }
          />
        )}
      />
    </View>
  );
}
