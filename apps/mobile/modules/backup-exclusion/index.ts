import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

type BackupExclusionModule = {
  exclude: (uri: string) => Promise<boolean>;
};

// Android keeps the app's files out of backups through the manifest's
// backup rules (plugins/with-no-backup.js), so the module is iOS only.
export const BackupExclusion =
  Platform.OS === 'ios'
    ? requireNativeModule<BackupExclusionModule>('BackupExclusion')
    : null;
