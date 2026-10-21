import { Redirect } from 'expo-router';
import { DiagnosticsView } from '../features/diagnostics/index.ts';

export default function DiagnosticsScreen() {
  return __DEV__ ? <DiagnosticsView /> : <Redirect href="/" />;
}
