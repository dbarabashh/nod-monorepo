import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ndkTools } from './android-ndk.ts';
import { builtLibrary, cargoBuild, root } from './cargo.ts';

const minSdk = 24;
// Every ABI React Native ships, so no device lacks the library at startup.
const targets = [
  {
    rust: 'aarch64-linux-android',
    abi: 'arm64-v8a',
    clang: 'aarch64-linux-android',
  },
  {
    rust: 'armv7-linux-androideabi',
    abi: 'armeabi-v7a',
    clang: 'armv7a-linux-androideabi',
  },
  {
    rust: 'x86_64-linux-android',
    abi: 'x86_64',
    clang: 'x86_64-linux-android',
  },
  { rust: 'i686-linux-android', abi: 'x86', clang: 'i686-linux-android' },
];

// Gradle passes the app's reactNativeArchitectures, so a build for one
// emulator compiles one ABI.
const wanted = (process.env.NOD_ANDROID_ABIS ?? '')
  .split(',')
  .map((abi) => abi.trim())
  .filter(Boolean);
const selected =
  wanted.length > 0 ? targets.filter((t) => wanted.includes(t.abi)) : targets;

const { bin, exe, cmd } = ndkTools();
// A global RUSTFLAGS would replace the per-target flags below, dropping the
// 16 KB page alignment.
const env: NodeJS.ProcessEnv = {
  RUSTFLAGS: undefined,
  CARGO_ENCODED_RUSTFLAGS: undefined,
};
for (const { rust, clang } of selected) {
  const linker = path.join(bin, `${clang}${minSdk}-clang${cmd}`);
  const cargoKey = `CARGO_TARGET_${rust.toUpperCase().replaceAll('-', '_')}`;
  const ccKey = rust.replaceAll('-', '_');
  env[`${cargoKey}_LINKER`] = linker;
  // Android 15+ devices may use 16 KB memory pages.
  env[`${cargoKey}_RUSTFLAGS`] = '-C link-arg=-Wl,-z,max-page-size=16384';
  env[`CC_${ccKey}`] = linker;
  env[`AR_${ccKey}`] = path.join(bin, `llvm-ar${exe}`);
}

await cargoBuild(
  selected.map((t) => t.rust),
  env,
);
for (const { rust, abi } of selected) {
  const outDir = path.join(root, 'android', 'src', 'main', 'jniLibs', abi);
  await mkdir(outDir, { recursive: true });
  await copyFile(
    builtLibrary(rust, 'libnod_automerge.so'),
    path.join(outDir, 'libnod_automerge.so'),
  );
}
