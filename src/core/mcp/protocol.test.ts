import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  appendTranscript,
  finishMeeting,
  moveToFolder,
  setSummary,
  startMeeting,
  type Meeting,
  type Speaker,
} from '../meetings/index.ts';
import { handleMessage, handleMessages, type McpContext } from './protocol.ts';
import { transcriptPageChars } from './tools.ts';
import type { McpScope } from './tools.ts';

const launch: Meeting = moveToFolder(
  setSummary(
    finishMeeting(
      appendTranscript(
        startMeeting('m1', 'Launch sync', Date.UTC(2026, 9, 14, 9)),
        [
          {
            id: 'a',
            speaker: 'me',
            startMs: 0,
            endMs: 2_000,
            text: 'Where is the relay?',
          },
          {
            id: 'b',
            speaker: 'others',
            startMs: 65_000,
            endMs: 70_000,
            text: 'Marta sends the Lisbon contract on Thursday.',
          },
        ],
      ),
      Date.UTC(2026, 9, 14, 9, 30),
    ),
    'Relay is live. Contract goes out Thursday.',
  ),
  'Clients',
);
const standup: Meeting = startMeeting(
  'm2',
  'Standup',
  Date.UTC(2026, 9, 15, 8),
);

function contextWith(scopes: McpScope[]) {
  const calls: Array<{ tool: string; ids: string[] }> = [];
  const context: McpContext = {
    scopes,
    meetings: () => [launch, standup],
    serverVersion: '1.2.3',
    admitCall: () => true,
    onToolCall: (tool, result) => calls.push({ tool, ids: result.meetingIds }),
  };
  return { context, calls };
}

function call(
  context: McpContext,
  name: string,
  args: Record<string, unknown>,
) {
  const reply = handleMessage(
    {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    context,
  );
  assert.ok(reply && 'result' in reply);
  const result = reply.result;
  assert.ok(typeof result === 'object' && result !== null);
  const content = Reflect.get(result, 'content');
  assert.ok(Array.isArray(content));
  const text: unknown = Reflect.get(content[0], 'text');
  assert.equal(typeof text, 'string');
  return {
    isError: Reflect.get(result, 'isError'),
    data:
      typeof text === 'string' && !Reflect.get(result, 'isError')
        ? JSON.parse(text)
        : text,
  };
}

describe('MCP protocol', () => {
  it('agrees on a protocol version it speaks, or offers its newest', () => {
    const { context } = contextWith([]);
    const reply = (version: string) =>
      handleMessage(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: version },
        },
        context,
      );
    const first = reply('2025-03-26');
    assert.ok(first && 'result' in first);
    assert.equal(
      Reflect.get(Object(first.result), 'protocolVersion'),
      '2025-03-26',
    );
    assert.deepEqual(Reflect.get(Object(first.result), 'serverInfo'), {
      name: 'nod',
      version: '1.2.3',
    });
    const other = reply('1999-01-01');
    assert.ok(other && 'result' in other);
    assert.equal(
      Reflect.get(Object(other.result), 'protocolVersion'),
      '2025-06-18',
    );
  });

  it('answers requests, stays silent on notifications and rejects what is not JSON-RPC', () => {
    const { context } = contextWith([]);
    assert.equal(
      handleMessage(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        context,
      ),
      null,
    );
    assert.deepEqual(
      handleMessage({ jsonrpc: '2.0', id: 'p', method: 'ping' }, context),
      {
        jsonrpc: '2.0',
        id: 'p',
        result: {},
      },
    );
    assert.deepEqual(
      handleMessage(
        { jsonrpc: '2.0', id: 3, method: 'resources/list' },
        context,
      ),
      {
        jsonrpc: '2.0',
        id: 3,
        error: { code: -32601, message: 'Method not found' },
      },
    );
    for (const bad of [
      'text',
      [],
      { id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: {}, method: 'ping' },
    ]) {
      assert.deepEqual(handleMessage(bad, context), {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid request' },
      });
    }
  });

  it('answers each request in a batch and nothing for a batch of notifications', () => {
    const { context } = contextWith([]);
    assert.deepEqual(
      handleMessages(
        [
          { jsonrpc: '2.0', id: 1, method: 'ping' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 2, method: 'nope' },
        ],
        context,
      ),
      [
        { jsonrpc: '2.0', id: 1, result: {} },
        {
          jsonrpc: '2.0',
          id: 2,
          error: { code: -32601, message: 'Method not found' },
        },
      ],
    );
    assert.equal(
      handleMessages(
        [{ jsonrpc: '2.0', method: 'notifications/initialized' }],
        context,
      ),
      null,
    );
    assert.deepEqual(handleMessages([], context), {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid request' },
    });
  });

  it('ignores a client’s reply and turns a failure into an internal error', () => {
    const { context } = contextWith([]);
    assert.equal(
      handleMessage({ jsonrpc: '2.0', id: 9, result: {} }, context),
      null,
    );
    const broken: McpContext = {
      ...context,
      meetings: () => {
        throw new Error('disk');
      },
    };
    assert.deepEqual(
      handleMessage(
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'list_meetings' },
        },
        broken,
      ),
      {
        jsonrpc: '2.0',
        id: 4,
        error: { code: -32603, message: 'Internal error' },
      },
    );
  });

  it('refuses tool calls the limit doesn’t admit, and batches over the cap', () => {
    const { context } = contextWith([]);
    let admitted = 1;
    const limited: McpContext = {
      ...context,
      admitCall: () => {
        admitted -= 1;
        return admitted >= 0;
      },
    };
    const callOnce = (id: number) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'list_folders' },
    });
    const replies = handleMessages([callOnce(1), callOnce(2)], limited);
    assert.ok(Array.isArray(replies));
    assert.equal('result' in (replies[0] ?? {}), true);
    assert.deepEqual(replies[1], {
      jsonrpc: '2.0',
      id: 2,
      error: {
        code: -32000,
        message:
          'Too many requests from this assistant; try again in a minute.',
      },
    });
    assert.deepEqual(
      handleMessages(
        Array.from({ length: 21 }, (_, index) => callOnce(index)),
        context,
      ),
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Send at most 20 messages at once.' },
      },
    );
  });

  it('lists the four read-only tools', () => {
    const { context } = contextWith(['summaries']);
    const reply = handleMessage(
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      context,
    );
    assert.ok(reply && 'result' in reply);
    const tools: unknown = Reflect.get(Object(reply.result), 'tools');
    assert.ok(Array.isArray(tools));
    assert.deepEqual(
      tools.map((tool) => Reflect.get(tool, 'name')),
      ['list_meetings', 'search_meetings', 'get_meeting', 'list_folders'],
    );
  });
});

describe('MCP tools', () => {
  it('lists meetings newest first, optionally by folder', () => {
    const { context, calls } = contextWith([]);
    assert.deepEqual(call(context, 'list_meetings', {}).data, [
      {
        id: 'm2',
        name: 'Standup',
        startedAt: '2026-10-15T08:00:00.000Z',
        minutes: 0,
        folder: null,
      },
      {
        id: 'm1',
        name: 'Launch sync',
        startedAt: '2026-10-14T09:00:00.000Z',
        minutes: 0,
        folder: 'Clients',
      },
    ]);
    assert.deepEqual(
      call(context, 'list_meetings', { folder: 'Clients', limit: 5 }).data.map(
        (meeting: { id: string }) => meeting.id,
      ),
      ['m1'],
    );
    assert.deepEqual(calls[0], { tool: 'list_meetings', ids: ['m2', 'm1'] });
  });

  it('gives a meeting only the parts the assistant was allowed', () => {
    const nameOnly = call(contextWith([]).context, 'get_meeting', {
      id: 'm1',
    }).data;
    assert.equal('summary' in nameOnly, false);
    assert.equal('transcript' in nameOnly, false);

    const everything = call(
      contextWith(['summaries', 'transcripts']).context,
      'get_meeting',
      {
        id: 'm1',
      },
    ).data;
    assert.equal(
      everything.summary,
      'Relay is live. Contract goes out Thursday.',
    );
    assert.equal(
      everything.transcript,
      '[0:00] Me: Where is the relay?\n[1:05] Others: Marta sends the Lisbon contract on Thursday.',
    );
    assert.equal(everything.finished, true);

    const missing = call(contextWith([]).context, 'get_meeting', {
      id: 'nope',
    });
    assert.equal(missing.isError, true);
  });

  it('searches only the text the assistant may read', () => {
    const transcripts = contextWith(['transcripts']).context;
    const found = call(transcripts, 'search_meetings', {
      query: 'lisbon',
    }).data;
    assert.deepEqual(
      found.map((meeting: { id: string; match: string; excerpt: string }) => [
        meeting.id,
        meeting.match,
        meeting.excerpt,
      ]),
      [
        [
          'm1',
          'transcript',
          '[0:00] Me: Where is the relay? [1:05] Others: Marta sends the Lisbon contract on Thursday.',
        ],
      ],
    );
    assert.deepEqual(
      call(contextWith([]).context, 'search_meetings', { query: 'lisbon' })
        .data,
      [],
    );
    assert.deepEqual(
      call(contextWith([]).context, 'search_meetings', {
        query: 'CLIENTS',
      }).data.map((meeting: { match: string }) => meeting.match),
      ['folder'],
    );
    assert.equal(
      call(transcripts, 'search_meetings', { query: '  ' }).isError,
      true,
    );
  });

  it('finds the match in text whose lowercase is longer, and treats the query literally', () => {
    const turkish = setSummary(
      startMeeting(
        'm3',
        `${'İ'.repeat(120)} Deadline moved`,
        Date.UTC(2026, 9, 16),
      ),
      'x',
    );
    const context: McpContext = {
      ...contextWith([]).context,
      meetings: () => [turkish],
    };
    const [hit] = call(context, 'search_meetings', { query: 'deadline' }).data;
    assert.match(hit.excerpt, /Deadline moved$/);
    assert.deepEqual(
      call(context, 'search_meetings', { query: '.*' }).data,
      [],
    );
  });

  it('hands out a long transcript in pages', () => {
    const me: Speaker = 'me';
    const line = 'x'.repeat(1_000);
    const long = appendTranscript(
      startMeeting('m4', 'Long', 0),
      Array.from({ length: 100 }, (_, index) => ({
        id: `l${index}`,
        speaker: me,
        startMs: index * 1_000,
        endMs: index * 1_000 + 500,
        text: line,
      })),
    );
    const context: McpContext = {
      ...contextWith(['transcripts']).context,
      meetings: () => [long],
    };
    const first = call(context, 'get_meeting', { id: 'm4' }).data;
    assert.equal(first.transcript.length, transcriptPageChars);
    assert.equal(first.nextOffset, transcriptPageChars);
    const past = call(context, 'get_meeting', {
      id: 'm4',
      offset: 999_999,
    }).data;
    assert.equal(past.transcript, '');
    assert.equal(past.nextOffset, undefined);
    const second = call(context, 'get_meeting', {
      id: 'm4',
      offset: first.nextOffset,
    }).data;
    assert.equal(second.nextOffset, undefined);
    assert.equal(first.transcript.length + second.transcript.length, 101_199);
  });

  it('counts meetings per folder', () => {
    assert.deepEqual(call(contextWith([]).context, 'list_folders', {}).data, [
      { name: 'Clients', meetings: 1 },
    ]);
  });
});
