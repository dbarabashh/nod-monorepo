import type { Transport } from '../transport.ts';

export function countingTransport<T extends Transport>(transport: T) {
  let writes = 0;
  return {
    transport: {
      ...transport,
      write: (path: string, data: Uint8Array) => {
        writes += 1;
        return transport.write(path, data);
      },
    },
    writes: () => writes,
  };
}
