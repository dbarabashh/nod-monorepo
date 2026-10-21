import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { text, useColors, weight } from '../theme/index.ts';

export default function RootLayout() {
  const colors = useColors();
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
        <Stack.Screen name="components" options={{ title: 'Design system' }} />
      </Stack>
    </>
  );
}
