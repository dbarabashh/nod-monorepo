import { getRandomValues } from 'expo-crypto';

// Hermes has no Web Crypto. @nod/core's ciphers read crypto.getRandomValues
// for nonces and keys, so it is backed by the platform's secure generator
// before anything encrypts.
function installRandomValues() {
  const existing: unknown = Reflect.get(globalThis, 'crypto');
  if (
    typeof existing === 'object' &&
    existing !== null &&
    typeof Reflect.get(existing, 'getRandomValues') === 'function'
  ) {
    return;
  }
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { getRandomValues },
  });
}

installRandomValues();
