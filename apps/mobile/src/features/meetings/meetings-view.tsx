import { useState, type ReactNode } from 'react';
import { Alert, FlatList, RefreshControl, View } from 'react-native';
import { Link, Redirect, useRouter } from 'expo-router';
import {
  meetingName,
  meetingStartedAt,
  recordedMs,
  type Meeting,
} from '@nod/core/meetings';
import {
  Button,
  EmptyState,
  ListRow,
  Text,
} from '../../components/ui/index.ts';
import {
  resetSync,
  stopSyncing,
  syncNow,
  useSync,
  type SyncState,
} from '../../lib/sync/sync.ts';
import { messageOf } from '../../lib/message-of.ts';
import { space, themed, useColors, useScheme } from '../../theme/index.ts';
import { formatDuration } from './lib/format-duration.ts';
import { clockFormat, dateTimeFormat } from '../../lib/formats.ts';

type Paired = Extract<SyncState, { status: 'paired' }>;
type Unavailable = Extract<SyncState, { status: 'unavailable' }>;

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', backgroundColor: colors.bg },
  content: { flexGrow: 1, gap: space[1], padding: space[4] },
  header: { gap: space[2], paddingBottom: space[3] },
  footer: { gap: space[2], alignItems: 'center', paddingTop: space[6] },
}));

function statusLine(sync: Paired): string {
  if (sync.syncing) {
    return 'Syncing with your computer…';
  }
  if (sync.error !== null) {
    return sync.error;
  }
  return sync.lastSyncedAt === null
    ? 'Not synced yet'
    : `Synced at ${clockFormat.format(sync.lastSyncedAt)}`;
}

function Header({ sync }: { sync: Paired }) {
  const styles = sheets[useScheme()];
  if (sync.closed) {
    return (
      <View style={styles.header}>
        <Text tone="danger">
          Your recovery phrase was changed on another device, so this phone
          stopped syncing. Pair it again with a device that has the new phrase.
        </Text>
        <Link href="/pair" asChild>
          <Button variant="primary">Pair again</Button>
        </Link>
      </View>
    );
  }
  return (
    <View style={styles.header}>
      <Text
        variant="sm"
        tone={sync.error !== null && !sync.syncing ? 'danger' : 'muted'}
        accessibilityLiveRegion="polite"
      >
        {statusLine(sync)}
      </Text>
    </View>
  );
}

function confirmStop() {
  Alert.alert(
    'Stop syncing on this phone?',
    'Its meetings stay here. The copies it put on the relay are removed, and it stops getting meetings from your other devices. You can pair it again later.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop syncing',
        style: 'destructive',
        onPress: () => {
          stopSyncing().catch((failure: unknown) =>
            Alert.alert('Couldn’t stop syncing', messageOf(failure)),
          );
        },
      },
    ],
  );
}

function Footer({ sync }: { sync: Paired }) {
  const styles = sheets[useScheme()];
  return (
    <View style={styles.footer}>
      <Text variant="sm" tone="muted">
        {`Vault code ${sync.vaultCode} · ${sync.relayHost}`}
      </Text>
      <Link href="/shared" asChild>
        <Button variant="outline" size="sm">
          Shared notes
        </Button>
      </Link>
      <Button variant="ghost" size="sm" onPress={confirmStop}>
        Stop syncing on this phone
      </Button>
      {__DEV__ && (
        <>
          <Link href="/components" asChild>
            <Button variant="outline" size="sm">
              Design system
            </Button>
          </Link>
          <Link href="/diagnostics" asChild>
            <Button variant="outline" size="sm">
              Diagnostics
            </Button>
          </Link>
        </>
      )}
    </View>
  );
}

const unavailableCopy: Record<
  NonNullable<Unavailable['reset']> | 'none',
  { title: string; detail: string; action: string | null }
> = {
  'start-over': {
    title: 'Meetings can’t be opened',
    detail:
      'The key to the meetings on this phone is missing, as after restoring a backup to another phone. Restart Nod first; if this stays, start over: the unreadable files are kept aside and your meetings come back from your other devices.',
    action: 'Start over',
  },
  'pair-again': {
    title: 'Sync settings can’t be read',
    detail:
      'Your meetings stay on this phone. Pair it again with your computer to keep syncing.',
    action: 'Pair again',
  },
  none: {
    title: 'Meetings can’t be opened',
    detail:
      'Restart Nod. If it keeps happening, the keys on this phone may have been reset.',
    action: null,
  },
};

function UnavailableState({ sync }: { sync: Unavailable }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const copy = unavailableCopy[sync.reset ?? 'none'];
  const reset = () => {
    setBusy(true);
    setFailed(null);
    resetSync().catch((failure: unknown) => {
      setFailed(messageOf(failure));
      setBusy(false);
    });
  };
  return (
    <EmptyState
      icon="key"
      title={copy.title}
      description={`${sync.error}. ${copy.detail}${failed ? ` ${failed}` : ''}`}
    >
      {copy.action !== null && (
        <Button variant="primary" disabled={busy} onPress={reset}>
          {copy.action}
        </Button>
      )}
    </EmptyState>
  );
}

// The dock under the list (recording) comes from the route, so this feature
// doesn't import another.
export function MeetingsView({ bottomBar }: { bottomBar?: ReactNode }) {
  const styles = sheets[useScheme()];
  const colors = useColors();
  const router = useRouter();
  const sync = useSync();
  const [refreshing, setRefreshing] = useState(false);

  if (sync.status === 'loading') {
    return <View style={styles.centered} />;
  }
  if (sync.sync.status === 'unpaired') {
    return <Redirect href="/pair" />;
  }
  if (sync.sync.status === 'unavailable') {
    return (
      <View style={styles.centered}>
        <UnavailableState sync={sync.sync} />
      </View>
    );
  }
  const paired = sync.sync;

  const refresh = () => {
    setRefreshing(true);
    void syncNow().finally(() => setRefreshing(false));
  };

  const open = (meeting: Meeting) =>
    router.push({ pathname: '/meeting/[id]', params: { id: meeting.id } });

  return (
    <View style={styles.screen}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        data={sync.meetings}
        keyExtractor={(meeting) => meeting.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textMuted}
            colors={[colors.accent]}
          />
        }
        ListHeaderComponent={<Header sync={paired} />}
        ListFooterComponent={<Footer sync={paired} />}
        ListEmptyComponent={
          <EmptyState
            icon={paired.syncing ? 'sync' : 'mic'}
            title={
              paired.syncing ? 'Getting your meetings…' : 'No meetings yet'
            }
            description="Meetings you record here or on your computer show up here."
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={meetingName(item)}
            meta={`${dateTimeFormat.format(meetingStartedAt(item))} · ${formatDuration(recordedMs(item) / 1000)}`}
            accessibilityHint="Opens the summary and transcript"
            onPress={() => open(item)}
          />
        )}
      />
      {bottomBar}
    </View>
  );
}
