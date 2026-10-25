import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  View,
} from 'react-native';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import { Redirect, useRouter } from 'expo-router';
import { vaultCodeOf, vaultIdOf } from '@nod/core/crypto';
import {
  readPairingCode,
  type PairingCode,
  type PairingOffer,
} from '@nod/core/sync';
import { QrScannerView } from '../../../modules/qr-scanner/index.ts';
import { Button, Icon, Text } from '../../components/ui/index.ts';
import { messageOf } from '../../lib/message-of.ts';
import { fetchPairingOffer } from '../../lib/sync/device.ts';
import { hasLocalMeetings, pairWith, useSync } from '../../lib/sync/sync.ts';
import {
  control,
  radius,
  size,
  space,
  themed,
  useColors,
  useScheme,
} from '../../theme/index.ts';

type Phase =
  | { kind: 'intro' }
  | { kind: 'scanning' }
  | { kind: 'connecting' }
  | { kind: 'allowing'; asker: string | null }
  | { kind: 'confirm'; offer: PairingOffer }
  | { kind: 'pairing' };

const sheets = themed((colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, gap: space[6], padding: space[6] },
  heading: { gap: space[2] },
  steps: { gap: space[3] },
  step: { flexDirection: 'row', gap: space[3] },
  stepNumber: {
    alignItems: 'center',
    justifyContent: 'center',
    width: control.heightSm,
    height: control.heightSm,
    borderRadius: radius.full,
    backgroundColor: colors.field,
  },
  stepText: { flex: 1, justifyContent: 'center' },
  cameraFeed: { flex: 1 },
  camera: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.lg,
    borderWidth: size.borderWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  pairing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[4],
  },
  actions: { gap: space[2] },
}));

const steps = [
  'Put this phone on the same Wi‑Fi as your computer.',
  'In Nod on the computer, go to Settings → Sync and choose “Pair a phone”.',
  'Scan the code it shows.',
];

export function PairingView() {
  const styles = sheets[useScheme()];
  const colors = useColors();
  const router = useRouter();
  const sync = useSync();
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [error, setError] = useState<string | null>(null);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  // The camera reports the same code many times a second.
  const handling = useRef(false);
  const rejected = useRef<string | null>(null);
  const pairing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const paired =
    sync.status === 'ready' &&
    sync.sync.status === 'paired' &&
    !sync.sync.closed;
  if (paired && phase.kind !== 'pairing') {
    return <Redirect href="/" />;
  }

  // Asked only when the user wants to scan; Settings is offered only once
  // the system won't ask again.
  const scan = async () => {
    setError(null);
    const answer = permission?.granted ? permission : await requestPermission();
    setCameraBlocked(!answer.granted && !answer.canAskAgain);
    if (answer.granted) {
      rejected.current = null;
      setPhase({ kind: 'scanning' });
    } else {
      setError(
        answer.canAskAgain
          ? 'Nod needs the camera to scan the pairing code.'
          : 'Camera access is off for Nod. Turn it on in Settings, then scan the code.',
      );
    }
  };

  const pair = (offer: PairingOffer) => {
    if (pairing.current) {
      return;
    }
    pairing.current = true;
    setError(null);
    setPhase({ kind: 'pairing' });
    pairWith(offer).then(
      () => {
        if (mounted.current) {
          router.dismissTo('/');
        }
      },
      (failure: unknown) => {
        pairing.current = false;
        handling.current = false;
        if (mounted.current) {
          setError(messageOf(failure));
          setPhase({ kind: 'intro' });
        }
      },
    );
  };

  // The code only says where the computer listens on this network; the
  // vault comes from the computer itself, which also proves the phone is on
  // its network. A phone that already holds meetings would send them to that
  // vault, so it shows the vault first, to compare with the computer.
  const scanned = ({ data }: Pick<BarcodeScanningResult, 'data'>) => {
    if (handling.current || data === rejected.current) {
      return;
    }
    let code: PairingCode;
    try {
      code = readPairingCode(data);
    } catch (failure) {
      rejected.current = data;
      setError(messageOf(failure));
      return;
    }
    handling.current = true;
    rejected.current = data;
    setError(null);
    setPhase({ kind: 'connecting' });
    fetchPairingOffer(code, (asker) => {
      if (mounted.current) {
        setPhase({ kind: 'allowing', asker });
      }
    }).then(
      (offer) => {
        if (!mounted.current) {
          return;
        }
        if (hasLocalMeetings()) {
          setPhase({ kind: 'confirm', offer });
        } else {
          pair(offer);
        }
      },
      (failure: unknown) => {
        handling.current = false;
        if (mounted.current) {
          setError(messageOf(failure));
          setPhase({ kind: 'intro' });
        }
      },
    );
  };

  const cancel = () => {
    handling.current = false;
    setPhase({ kind: 'intro' });
  };

  if (phase.kind === 'confirm') {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        <View style={styles.heading}>
          <Text variant="xl" accessibilityRole="header">
            Sync this phone’s meetings?
          </Text>
          <Text tone="muted">
            {`Your computer handed over vault ${vaultCodeOf(vaultIdOf(phase.offer.key))}. The meetings already on this phone will join it and sync through ${new URL(phase.offer.relayUrl).host}.`}
          </Text>
        </View>
        <View style={styles.actions}>
          <Button variant="primary" onPress={() => pair(phase.offer)}>
            Pair and sync
          </Button>
          <Button variant="outline" onPress={cancel}>
            Cancel
          </Button>
        </View>
      </ScrollView>
    );
  }

  if (
    phase.kind === 'pairing' ||
    phase.kind === 'connecting' ||
    phase.kind === 'allowing'
  ) {
    return (
      <View style={[styles.screen, styles.pairing]}>
        <ActivityIndicator color={colors.textMuted} />
        <Text variant="lg" weight="semibold" accessibilityLiveRegion="polite">
          {phase.kind === 'connecting'
            ? 'Connecting to your computer…'
            : phase.kind === 'allowing'
              ? 'Choose Pair on your computer'
              : 'Getting your meetings…'}
        </Text>
        <Text tone="muted">
          {phase.kind === 'allowing'
            ? phase.asker
              ? `Your computer asks before it shares anything. It should name this phone as ${phase.asker}.`
              : 'Your computer asks before it shares anything with this phone.'
            : 'They stay encrypted on the way.'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={styles.heading}>
        <Text variant="xl" accessibilityRole="header">
          Sync with your computer
        </Text>
        <Text tone="muted">
          Your meetings come to this phone end to end encrypted. Only your
          devices can read them.
        </Text>
      </View>
      {phase.kind === 'scanning' ? (
        <View style={styles.camera}>
          {Platform.OS === 'android' && QrScannerView !== null ? (
            <QrScannerView
              style={styles.cameraFeed}
              onScan={({ nativeEvent }) => scanned(nativeEvent)}
              onError={({ nativeEvent }) => {
                setError(nativeEvent.message);
                setPhase({ kind: 'intro' });
              }}
              accessibilityLabel="Camera view for scanning the pairing code"
            />
          ) : (
            <CameraView
              style={styles.cameraFeed}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned}
              accessibilityLabel="Camera view for scanning the pairing code"
            />
          )}
        </View>
      ) : (
        <View style={styles.steps}>
          {steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text weight="semibold">{String(index + 1)}</Text>
              </View>
              <View style={styles.stepText}>
                <Text>{step}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
      {error !== null && (
        <Text tone="danger" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      )}
      <View style={styles.actions}>
        {phase.kind === 'scanning' ? (
          <Button variant="outline" onPress={cancel}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="primary" icon="sync" onPress={() => void scan()}>
              Scan pairing code
            </Button>
            {cameraBlocked && (
              <Button
                variant="outline"
                onPress={() => void Linking.openSettings()}
              >
                Open Settings
              </Button>
            )}
          </>
        )}
      </View>
      <View style={styles.step}>
        <Icon name="key" color={colors.textMuted} />
        <View style={styles.stepText}>
          <Text variant="sm" tone="muted">
            The code works once, only on your Wi‑Fi, while it shows on your
            computer. Scan it only from your own computer.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}
