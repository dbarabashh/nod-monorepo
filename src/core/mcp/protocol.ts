import type { Meeting } from '../meetings/index.ts';
import {
  callTool,
  toolDefinitions,
  type McpScope,
  type ToolResult,
} from './tools.ts';

export const protocolVersions = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const maxBatch = 20;

export type McpContext = {
  scopes: readonly McpScope[];
  meetings: () => readonly Meeting[];
  serverVersion: string;
  // Asked once per tool call, batches included, so a limit on calls can't be
  // dodged by packing many into one request.
  admitCall: () => boolean;
  onToolCall: (tool: string, result: ToolResult) => void;
};

type JsonRpcId = string | number;

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: JsonRpcId | null; result: unknown }
  | {
      jsonrpc: '2.0';
      id: JsonRpcId | null;
      error: { code: number; message: string };
    };

const instructions =
  'Nod holds the user’s recorded meetings. Find meetings with search_meetings or list_meetings, then read one with get_meeting. Everything is read only.';

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(
  id: JsonRpcId | null,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function argumentsOf(params: unknown): Record<string, unknown> | null {
  const args = field(params, 'arguments') ?? {};
  if (
    typeof params !== 'object' ||
    params === null ||
    typeof args !== 'object' ||
    args === null ||
    Array.isArray(args)
  ) {
    return null;
  }
  return Object.fromEntries(Object.entries(args));
}

export function handleMessages(
  messages: unknown,
  context: McpContext,
): JsonRpcResponse | JsonRpcResponse[] | null {
  if (!Array.isArray(messages)) {
    return handleMessage(messages, context);
  }
  if (messages.length === 0 || messages.length > maxBatch) {
    return failure(
      null,
      -32600,
      messages.length === 0
        ? 'Invalid request'
        : `Send at most ${maxBatch} messages at once.`,
    );
  }
  const replies = messages
    .map((message) => handleMessage(message, context))
    .filter((reply) => reply !== null);
  return replies.length === 0 ? null : replies;
}

export function handleMessage(
  message: unknown,
  context: McpContext,
): JsonRpcResponse | null {
  try {
    return answer(message, context);
  } catch {
    const id = field(message, 'id');
    return failure(isId(id) ? id : null, -32603, 'Internal error');
  }
}

function answer(message: unknown, context: McpContext): JsonRpcResponse | null {
  if (Array.isArray(message) || field(message, 'jsonrpc') !== '2.0') {
    return failure(null, -32600, 'Invalid request');
  }
  const method = field(message, 'method');
  const id = field(message, 'id');
  // A notification, or a client's reply to a request: neither is answered.
  if (id === undefined || method === undefined) {
    return null;
  }
  if (!isId(id)) {
    return failure(null, -32600, 'Invalid request');
  }
  const params = field(message, 'params');
  switch (method) {
    case 'initialize': {
      const asked = field(params, 'protocolVersion');
      return success(id, {
        protocolVersion:
          typeof asked === 'string' && protocolVersions.includes(asked)
            ? asked
            : protocolVersions[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'nod', version: context.serverVersion },
        instructions,
      });
    }
    case 'ping':
      return success(id, {});
    case 'tools/list':
      return success(id, { tools: toolDefinitions(context.scopes) });
    case 'tools/call': {
      const name = field(params, 'name');
      const args = argumentsOf(params);
      if (typeof name !== 'string' || args === null) {
        return failure(id, -32602, 'Invalid params');
      }
      if (!context.admitCall()) {
        return failure(
          id,
          -32000,
          'Too many requests from this assistant; try again in a minute.',
        );
      }
      const result = callTool(
        { name, arguments: args },
        context.meetings(),
        context.scopes,
      );
      context.onToolCall(name, result);
      return success(id, {
        content: [{ type: 'text', text: result.text }],
        isError: result.isError,
      });
    }
    default:
      return failure(id, -32601, 'Method not found');
  }
}
