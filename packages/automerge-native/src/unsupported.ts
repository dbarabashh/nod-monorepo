export function unsupported(name: string): never {
  throw new Error(`${name} is not supported by the native Automerge backend`);
}

/** Document methods of the wasm backend this one refuses rather than imitates. */
export const unsupportedDocumentMethods = [
  'addCommits',
  'addFragments',
  'anonymize',
  'bundleFragmentMetadata',
  'diff',
  'diffPath',
  'dump',
  'generateSyncMessage',
  'getActorsForAuthor',
  'getAuthor',
  'getAuthorForActor',
  'getAuthors',
  'getBlock',
  'getChangeByHash',
  'getChangeMetaByHash',
  'getChangesMeta',
  'getCursor',
  'getCursorPosition',
  'getDecodedChangeByHash',
  'getFragmentMeta',
  'getFragmentMetadata',
  'hasOurChanges',
  'joinBlock',
  'mark',
  'marks',
  'marksAt',
  'objInfo',
  'receiveSyncMessage',
  'saveAndVerify',
  'saveBundle',
  'saveNoCompress',
  'setAuthor',
  'spans',
  'splitBlock',
  'stats',
  'topoHistoryTraversal',
  'unmark',
  'updateBlock',
  'updateSpans',
];

export const unsupportedModuleFunctions = [
  'encodeChange',
  'decodeChange',
  'initSyncState',
  'encodeSyncMessage',
  'decodeSyncMessage',
  'encodeSyncState',
  'decodeSyncState',
  'exportSyncState',
  'importSyncState',
  'readBundle',
];

/** Methods that throw, so a missing feature fails loudly instead of misbehaving. */
export function refusals(
  names: readonly string[],
): Record<string, () => never> {
  return Object.fromEntries(
    names.map((name) => [name, () => unsupported(name)]),
  );
}
