import type { Fetch } from '../models/download.ts';

export function stallingFetch(firstBytes: Uint8Array): {
  fetch: Fetch;
  started: Promise<void>;
} {
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const fetch: Fetch = async (_url, init) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(firstBytes);
        },
        pull(stream) {
          markStarted();
          return new Promise((resolve) => {
            const fail = () => {
              stream.error(new DOMException('Aborted', 'AbortError'));
              resolve();
            };
            if (init.signal.aborted) {
              fail();
            } else {
              init.signal.addEventListener('abort', fail);
            }
          });
        },
      }),
      { status: 200 },
    );
  return { fetch, started };
}
