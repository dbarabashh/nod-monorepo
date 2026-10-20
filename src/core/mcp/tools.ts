import {
  meetingName,
  meetingStartedAt,
  meetingText,
  recordedMs,
  type Meeting,
} from '../meetings/index.ts';

export type McpScope = 'summaries' | 'transcripts';

export function isScope(value: unknown): value is McpScope {
  return value === 'summaries' || value === 'transcripts';
}

export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  text: string;
  isError: boolean;
  meetingIds: string[];
};

export type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: true; openWorldHint: false };
};

const readOnly: ToolDefinition['annotations'] = {
  readOnlyHint: true,
  openWorldHint: false,
};

const defaultListLimit = 20;
const maxListLimit = 200;
const defaultSearchLimit = 10;
const maxSearchLimit = 50;
const snippetRadius = 80;
// Assistants cap a tool reply at about 25,000 tokens, so a long transcript is
// handed out in pages the assistant asks for one after another.
export const transcriptPageChars = 60_000;

export function toolDefinitions(scopes: readonly McpScope[]): ToolDefinition[] {
  const parts = [
    'its name, date and length',
    ...(scopes.includes('summaries') ? ['the summary'] : []),
    ...(scopes.includes('transcripts') ? ['the transcript'] : []),
  ].join(', ');
  return [
    {
      name: 'list_meetings',
      title: 'List meetings',
      annotations: readOnly,
      description:
        'Lists recorded meetings, newest first, with their id, name, start time, length in minutes and folder.',
      inputSchema: {
        type: 'object',
        properties: {
          folder: {
            type: 'string',
            description: 'Only meetings filed in this folder.',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: maxListLimit,
            description: `How many to return, ${defaultListLimit} by default.`,
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'search_meetings',
      title: 'Search meetings',
      annotations: readOnly,
      description: `Finds meetings whose name${scopes.includes('summaries') ? ', summary' : ''}${scopes.includes('transcripts') ? ', transcript' : ''} or folder contain the words, newest first, with a short excerpt around the match.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1 },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: maxSearchLimit,
            description: `How many to return, ${defaultSearchLimit} by default.`,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_meeting',
      title: 'Read a meeting',
      annotations: readOnly,
      description: `Returns one meeting by id: ${parts}.${scopes.includes('transcripts') ? ' A long transcript comes in pages; pass the nextOffset it returns to read on.' : ''}`,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1 },
          ...(scopes.includes('transcripts')
            ? {
                offset: {
                  type: 'integer',
                  minimum: 0,
                  description:
                    'Where in the transcript to start, 0 by default.',
                },
              }
            : {}),
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_folders',
      title: 'List folders',
      annotations: readOnly,
      description:
        'Lists the folders meetings are filed in, with how many each holds.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}

function overview(meeting: Meeting) {
  return {
    id: meeting.id,
    name: meetingName(meeting),
    startedAt: new Date(meetingStartedAt(meeting)).toISOString(),
    minutes: Math.round(recordedMs(meeting) / 60_000),
    folder: meeting.folder,
  };
}

function newestFirst(meetings: readonly Meeting[]): Meeting[] {
  return meetings.toSorted((a, b) => meetingStartedAt(b) - meetingStartedAt(a));
}

function integerAtLeast(value: unknown, min: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min
    ? value
    : null;
}

function limitOf(value: unknown, fallback: number, max: number): number {
  return Math.min(integerAtLeast(value, 1) ?? fallback, max);
}

function transcriptPage(meeting: Meeting, offset: number) {
  const transcript = transcriptOf(meeting);
  const end = offset + transcriptPageChars;
  return end < transcript.length
    ? { transcript: transcript.slice(offset, end), nextOffset: end }
    : { transcript: transcript.slice(offset) };
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function excerpt(text: string, at: number, length: number): string {
  const start = Math.max(0, at - snippetRadius);
  const end = Math.min(text.length, at + length + snippetRadius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

// Meetings are replaced, never changed in place, so text built for one stays
// right until the meeting changes, and searching again doesn't rebuild every
// transcript.
const transcriptCache = new WeakMap<Meeting, string>();

function transcriptOf(meeting: Meeting): string {
  const cached = transcriptCache.get(meeting);
  if (cached !== undefined) {
    return cached;
  }
  const text = meetingText(meeting, 'transcript');
  transcriptCache.set(meeting, text);
  return text;
}

function searchable(
  meeting: Meeting,
  scopes: readonly McpScope[],
): Array<{ field: string; text: string }> {
  return [
    { field: 'name', text: meetingName(meeting) },
    ...(meeting.folder === null
      ? []
      : [{ field: 'folder', text: meeting.folder }]),
    ...(scopes.includes('summaries') && meeting.summary
      ? [{ field: 'summary', text: meeting.summary }]
      : []),
    ...(scopes.includes('transcripts')
      ? [{ field: 'transcript', text: transcriptOf(meeting) }]
      : []),
  ];
}

function json(value: unknown, meetingIds: string[]): ToolResult {
  return { text: JSON.stringify(value, null, 2), isError: false, meetingIds };
}

function failure(text: string): ToolResult {
  return { text, isError: true, meetingIds: [] };
}

export function callTool(
  call: ToolCall,
  meetings: readonly Meeting[],
  scopes: readonly McpScope[],
): ToolResult {
  const args = call.arguments;
  switch (call.name) {
    case 'list_meetings': {
      const folder = args.folder;
      if (folder !== undefined && typeof folder !== 'string') {
        return failure('folder must be text.');
      }
      const listed = newestFirst(meetings)
        .filter((meeting) => folder === undefined || meeting.folder === folder)
        .slice(0, limitOf(args.limit, defaultListLimit, maxListLimit));
      return json(
        listed.map(overview),
        listed.map((meeting) => meeting.id),
      );
    }
    case 'search_meetings': {
      const query = args.query;
      if (typeof query !== 'string' || query.trim() === '') {
        return failure('query must be non-empty text.');
      }
      const pattern = new RegExp(escaped(query.trim()), 'iu');
      const limit = limitOf(args.limit, defaultSearchLimit, maxSearchLimit);
      const found: Array<
        ReturnType<typeof overview> & { match: string; excerpt: string }
      > = [];
      for (const meeting of newestFirst(meetings)) {
        for (const { field, text } of searchable(meeting, scopes)) {
          const match = pattern.exec(text);
          if (match) {
            found.push({
              ...overview(meeting),
              match: field,
              excerpt: excerpt(text, match.index, match[0].length),
            });
            break;
          }
        }
        if (found.length >= limit) {
          break;
        }
      }
      return json(
        found,
        found.map((meeting) => meeting.id),
      );
    }
    case 'get_meeting': {
      const id = args.id;
      const meeting =
        typeof id === 'string'
          ? meetings.find((candidate) => candidate.id === id)
          : undefined;
      if (!meeting) {
        return failure(
          'No meeting has that id. Use list_meetings or search_meetings to find one.',
        );
      }
      const offset = integerAtLeast(args.offset, 0) ?? 0;
      return json(
        {
          ...overview(meeting),
          finished: meeting.finishedAt !== null,
          ...(scopes.includes('summaries') ? { summary: meeting.summary } : {}),
          ...(scopes.includes('transcripts')
            ? transcriptPage(meeting, offset)
            : {}),
        },
        [meeting.id],
      );
    }
    case 'list_folders': {
      const counts = new Map<string, number>();
      for (const meeting of meetings) {
        if (meeting.folder !== null) {
          counts.set(meeting.folder, (counts.get(meeting.folder) ?? 0) + 1);
        }
      }
      return json(
        [...counts]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, count]) => ({ name, meetings: count })),
        [],
      );
    }
    default:
      return failure(`Unknown tool ${call.name}.`);
  }
}
