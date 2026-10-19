import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { keyLength } from './aead.ts';

// The vault key written as 24 common English words (BIP39), so a person can
// copy it to paper and restore sync after losing every device.
export function recoveryPhrase(key: Uint8Array): string {
  if (key.length !== keyLength) {
    throw new Error('Only a vault key has a recovery phrase');
  }
  return entropyToMnemonic(key, wordlist);
}

// Every word in the list is plain a–z, so numbering, commas, line breaks and
// capitals that come with a phrase copied from paper or a note are dropped.
export function phraseWords(phrase: string): string[] {
  return phrase.toLowerCase().match(/[a-z]+/g) ?? [];
}

export function keyFromRecoveryPhrase(phrase: string): Uint8Array {
  const words = phraseWords(phrase).join(' ');
  if (!validateMnemonic(words, wordlist)) {
    throw new Error('That recovery phrase is not right. Check each word.');
  }
  const key = mnemonicToEntropy(words, wordlist);
  if (key.length !== keyLength) {
    throw new Error('That recovery phrase is not right. Check each word.');
  }
  return key;
}
