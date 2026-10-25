import type { ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text } from '../../../components/ui/index.ts';
import { formatClock } from '../../../lib/format-clock.ts';
import {
  control,
  dock,
  radius,
  size,
  space,
  themed,
  useScheme,
  weight,
} from '../../../theme/index.ts';

const sheets = themed((colors) => ({
  dock: {
    position: 'absolute',
    left: space[4],
    right: space[4],
    alignItems: 'center',
    gap: space[2],
  },
  notice: {
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderWidth: size.borderWidth,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: control.heightLg,
    paddingLeft: space[4],
    paddingRight: space[1],
    borderWidth: size.borderWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  note: { paddingRight: space[3] },
  action: {
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: control.minHit,
    minHeight: control.minHit,
    paddingHorizontal: control.paddingSm,
    borderRadius: radius.full,
  },
  pressed: { backgroundColor: colors.field },
  label: { fontWeight: weight.medium },
  go: { color: colors.toneSuccessFg },
  disabled: { color: colors.textDisabled },
  stopMark: {
    width: space[3],
    height: space[3],
    borderRadius: radius.xs,
    backgroundColor: colors.textMuted,
  },
}));

export function VoiceDock({
  problem,
  blocked,
  children,
}: {
  problem: string | null;
  blocked: boolean;
  children: ReactNode;
}) {
  const styles = sheets[useScheme()];
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom: insets.bottom + dock.offset }]}
    >
      {problem !== null && (
        <View style={styles.notice}>
          <Text variant="sm" tone="danger" accessibilityLiveRegion="assertive">
            {problem}
          </Text>
        </View>
      )}
      {blocked && (
        <Button variant="outline" onPress={() => void Linking.openSettings()}>
          Open Settings
        </Button>
      )}
      <View style={styles.pill}>{children}</View>
    </View>
  );
}

export function PillNote({ children }: { children: string }) {
  const styles = sheets[useScheme()];
  return (
    <Text tone="muted" numberOfLines={1} style={styles.note}>
      {children}
    </Text>
  );
}

export function PillAction({
  label,
  tone,
  disabled = false,
  busy = false,
  onPress,
}: {
  label: string;
  tone?: 'go';
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const styles = sheets[useScheme()];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.label,
          tone === 'go' && styles.go,
          disabled && styles.disabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function RecordingControls({
  interrupted,
  elapsed,
  onPause,
}: {
  interrupted: boolean;
  elapsed: number;
  onPause: () => void;
}) {
  const styles = sheets[useScheme()];
  return (
    <>
      {interrupted && <PillNote>Paused by a call</PillNote>}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${interrupted ? 'Paused by a call. ' : ''}Pause recording, ${formatClock(elapsed)} recorded`}
        onPress={onPause}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <View style={styles.stopMark} />
      </Pressable>
    </>
  );
}

export function PausedControls({
  starting,
  disabled = false,
  onResume,
  onFinish,
}: {
  starting: boolean;
  disabled?: boolean;
  onResume: () => void;
  onFinish: () => void;
}) {
  return (
    <>
      <PillAction
        label={starting ? 'Starting…' : 'Resume'}
        tone="go"
        disabled={starting || disabled}
        busy={starting}
        onPress={onResume}
      />
      <PillAction label="Finish" disabled={disabled} onPress={onFinish} />
    </>
  );
}
