import { isScope } from '@nod/core/mcp';
import {
  IpcChannel,
  IpcEvent,
  mcpNameMaxLength,
  type McpScope,
} from '../../shared/ipc.ts';
import type { McpService } from '../mcp/service.ts';
import { broadcast, handleFromApp } from '../security/sender.ts';

const maxSetupLength = 4_000;
const clipboardClearMs = 60_000;

type Clipboard = {
  writeText: (text: string) => void;
  readText: () => string | Promise<string>;
  clear: () => void;
};

function clientName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Name the assistant');
  }
  const name = value
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name === '' || name.length > mcpNameMaxLength) {
    throw new Error(
      `Name the assistant in up to ${mcpNameMaxLength} characters`,
    );
  }
  return name;
}

function scopesOf(value: unknown): McpScope[] {
  if (!Array.isArray(value) || !value.every(isScope)) {
    throw new Error('Unknown permission');
  }
  return [...new Set(value)];
}

export function broadcastMcp(service: McpService): void {
  broadcast(IpcEvent.onMcpChanged, service.state());
}

export function registerMcpIpc(
  appUrl: string,
  service: McpService,
  clipboard: Clipboard,
): void {
  handleFromApp(appUrl, IpcChannel.getMcpState, service.state);
  handleFromApp(appUrl, IpcChannel.setMcpEnabled, (enabled) => {
    if (typeof enabled !== 'boolean') {
      throw new Error('Expected on or off');
    }
    return service.setEnabled(enabled);
  });
  handleFromApp(appUrl, IpcChannel.addMcpClient, (name, scopes) =>
    service.addClient(clientName(name), scopesOf(scopes)),
  );
  handleFromApp(appUrl, IpcChannel.revokeMcpClient, (id) => {
    if (typeof id !== 'string') {
      throw new Error('Unknown assistant');
    }
    return service.revokeClient(id);
  });
  handleFromApp(appUrl, IpcChannel.copyMcpSetup, (text) => {
    if (typeof text !== 'string' || text.length > maxSetupLength) {
      throw new Error('Nothing to copy');
    }
    clipboard.writeText(text);
    // The setup holds the assistant's key; it shouldn't linger for whatever
    // reads the clipboard later.
    setTimeout(() => {
      void Promise.resolve()
        .then(() => clipboard.readText())
        .then((current) => {
          if (current === text) {
            clipboard.clear();
          }
        })
        .catch(() => undefined);
    }, clipboardClearMs);
  });
}
