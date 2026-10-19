export type Span = { startMs: number; endMs: number };

export type ChunkPlan = {
  chunks: Span[];
  consumeMs: number;
};

export type ChunkOptions = {
  tailMs: number;
  maxBufferMs: number;
  maxChunkMs: number;
};

export const defaultChunkOptions: ChunkOptions = {
  tailMs: 800,
  maxBufferMs: 30_000,
  maxChunkMs: 28_000,
};

function split(span: Span, maxChunkMs: number): Span[] {
  const parts: Span[] = [];
  for (let start = span.startMs; start < span.endMs; start += maxChunkMs) {
    parts.push({
      startMs: start,
      endMs: Math.min(start + maxChunkMs, span.endMs),
    });
  }
  return parts;
}

function group(speech: Span[], maxChunkMs: number): Span[] {
  const chunks: Span[] = [];
  for (const span of speech.flatMap((part) => split(part, maxChunkMs))) {
    const last = chunks.at(-1);
    if (last && span.endMs - last.startMs <= maxChunkMs) {
      last.endMs = span.endMs;
    } else {
      chunks.push({ ...span });
    }
  }
  return chunks;
}

export function planChunks(
  speech: Span[],
  bufferMs: number,
  final: boolean,
  options: ChunkOptions = defaultChunkOptions,
): ChunkPlan {
  const settledBefore = final ? bufferMs : bufferMs - options.tailMs;
  const settled = speech.filter((span) => span.endMs <= settledBefore);

  if (settled.length > 0) {
    return {
      chunks: group(settled, options.maxChunkMs),
      consumeMs: settled.at(-1)?.endMs ?? 0,
    };
  }
  if (bufferMs >= options.maxBufferMs) {
    return {
      chunks: group(
        speech.map((span) => ({
          ...span,
          endMs: Math.min(span.endMs, bufferMs),
        })),
        options.maxChunkMs,
      ),
      consumeMs: bufferMs,
    };
  }
  if (speech.length === 0) {
    return { chunks: [], consumeMs: Math.max(0, settledBefore) };
  }
  return { chunks: [], consumeMs: 0 };
}
