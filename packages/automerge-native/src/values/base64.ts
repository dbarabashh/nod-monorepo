import { stringOf } from '../guards.ts';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x1000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x1000));
  }
  return btoa(binary);
}

export function base64ToBytes(text: unknown): Uint8Array {
  const binary = atob(stringOf(text));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
