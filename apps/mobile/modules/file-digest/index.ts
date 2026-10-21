import { requireNativeModule } from 'expo';

type FileDigestModule = {
  sha256: (uri: string) => Promise<string>;
};

export const FileDigest = requireNativeModule<FileDigestModule>('FileDigest');
