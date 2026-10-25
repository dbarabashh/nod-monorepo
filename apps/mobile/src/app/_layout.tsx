import '../lib/random.ts';
import '../lib/automerge.ts';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { finishInterrupted } from '../lib/recording/recording.ts';
import { keepStorageOutOfBackup } from '../lib/storage.ts';
import { useSyncLoop } from '../lib/sync/sync.ts';
import { text, useColors, weight } from '../theme/index.ts';

export default function RootLayout() {
  const colors = useColors();
  useSyncLoop();
  useEffect(() => {
    void keepStorageOutOfBackup();
    void finishInterrupted();
  }, []);
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.bg },
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { ...text.rowTitle, fontWeight: weight.semibold },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Meetings' }} />
        <Stack.Screen name="pair" options={{ title: 'Pair with computer' }} />
        <Stack.Screen name="meeting/[id]" options={{ title: '' }} />
        <Stack.Screen name="shared" options={{ title: 'Shared notes' }} />
        <Stack.Screen name="shared-note" options={{ title: '' }} />
        <Stack.Screen name="models" options={{ title: 'Speech model' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Screen name="diagnostics" options={{ title: 'Diagnostics' }} />
      </Stack>
    </>
  );
}
