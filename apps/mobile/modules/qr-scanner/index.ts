import { requireNativeView } from 'expo';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

export type QrScanEvent = { nativeEvent: { data: string } };

export type QrScannerErrorEvent = { nativeEvent: { message: string } };

type QrScannerProps = ViewProps & {
  onScan: (event: QrScanEvent) => void;
  onError: (event: QrScannerErrorEvent) => void;
};

// Android reads QR codes with ZXing here instead of expo-camera's scanner,
// which is Google ML Kit and sends Google usage metrics. iOS scans with
// expo-camera, whose QR reading is the system's own AVFoundation.
export const QrScannerView: ComponentType<QrScannerProps> | null =
  Platform.OS === 'android'
    ? requireNativeView<QrScannerProps>('QrScanner')
    : null;
