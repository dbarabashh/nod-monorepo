// SPDX-FileCopyrightText: 2026 Dima Barabash
// SPDX-License-Identifier: AGPL-3.0-only

import {
  BlobError,
  BlobNotFoundError,
  BlobPreconditionFailedError,
  del,
  get,
  head,
  put,
} from '@vercel/blob';
import {
  Conflict,
  createRelayHandler,
  versionOf,
  type Storage,
} from '../relay.ts';
import { sourceUrlFrom } from '../../source.ts';

async function bytesOf(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// The store is private: blobs are reached only through this function, with
// the short-lived OIDC token Vercel gives it, never by a public URL. Reads skip
// the CDN cache so a device always sees the latest index and files.
const storage: Storage = {
  read: async (pathname) => {
    const result = await get(pathname, { access: 'private', useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) {
      return null;
    }
    return {
      data: await bytesOf(result.stream),
      version: versionOf(result.blob.etag),
    };
  },
  readChanged: async (pathname, version) => {
    const result = await get(pathname, {
      access: 'private',
      useCache: false,
      ifNoneMatch: version,
    });
    if (!result) {
      return null;
    }
    if (result.statusCode === 304) {
      return 'unchanged';
    }
    return {
      data: await bytesOf(result.stream),
      version: versionOf(result.blob.etag),
    };
  },
  stat: async (pathname) => {
    try {
      const result = await head(pathname);
      return { version: versionOf(result.etag), size: result.size };
    } catch (failure) {
      if (failure instanceof BlobNotFoundError) {
        return null;
      }
      throw failure;
    }
  },
  write: async (pathname, data, ifMatch) => {
    try {
      const result = await put(pathname, Buffer.from(data), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: ifMatch !== null,
        contentType: 'application/octet-stream',
        ...(typeof ifMatch === 'string' ? { ifMatch } : {}),
      });
      return versionOf(result.etag);
    } catch (failure) {
      // A concurrent write to the same object surfaces as a precondition
      // failure, an existing object or a conflicting operation; each means
      // "read again and retry".
      if (
        failure instanceof BlobPreconditionFailedError ||
        (failure instanceof BlobError &&
          /already exists|conflicting operation/i.test(failure.message))
      ) {
        throw new Conflict();
      }
      throw failure;
    }
  },
  remove: async (pathname) => {
    await del(pathname);
  },
};

// Keys the hourly hashes of client networks, so the stored hashes can't be
// reversed by trying every address.
const addressKey = process.env.RELAY_ADDRESS_KEY ?? '';
// A mistyped address must not take sync down for everyone, so it is logged
// and the notice left out, where the self-hosted relay refuses to start.
function configuredSourceUrl(): string | undefined {
  try {
    return sourceUrlFrom(process.env.RELAY_SOURCE_URL);
  } catch (failure) {
    console.error(failure instanceof Error ? failure.message : String(failure));
    return undefined;
  }
}
const sourceUrl = configuredSourceUrl();
const handle = addressKey
  ? createRelayHandler({
      storage,
      now: Date.now,
      addressKey,
      ...(sourceUrl ? { sourceUrl } : {}),
    })
  : null;

export default {
  fetch: async (request: Request) => {
    try {
      if (!handle) {
        throw new Error('RELAY_ADDRESS_KEY is not set');
      }
      return await handle(request);
    } catch (failure) {
      console.error(
        failure instanceof Error
          ? `${failure.name}: ${failure.message}`
          : 'Unknown failure',
      );
      return new Response(null, {
        status: 500,
        headers: { 'cache-control': 'no-store' },
      });
    }
  },
};
