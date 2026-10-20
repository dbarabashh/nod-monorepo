import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { setupText } from './setup.ts';

const state = {
  command: '/Applications/Nod.app/Contents/MacOS/Nod',
  args: ['--mcp-stdio'],
  port: 47823,
  url: 'http://127.0.0.1:47823/mcp',
};

describe('assistant setup', () => {
  it('starts Nod as a program with the key in its environment', () => {
    assert.equal(
      setupText('program', state, 'nod_mcp_abc'),
      `{
  "mcpServers": {
    "nod": {
      "command": "/Applications/Nod.app/Contents/MacOS/Nod",
      "args": [
        "--mcp-stdio"
      ],
      "env": {
        "NOD_MCP_KEY": "nod_mcp_abc",
        "NOD_MCP_PORT": "47823"
      }
    }
  }
}`,
    );
  });

  it('keeps a Windows path intact through JSON', () => {
    const windows = { ...state, command: 'C:\\Program Files\\Nod\\Nod.exe' };
    const text = setupText('program', windows, 'nod_mcp_abc');
    assert.match(text, /"command": "C:\\\\Program Files\\\\Nod\\\\Nod\.exe"/);
    assert.equal(
      JSON.parse(text).mcpServers.nod.command,
      'C:\\Program Files\\Nod\\Nod.exe',
    );
  });

  it('points address-based tools at the loopback endpoint with the key as a bearer token', () => {
    assert.deepEqual(JSON.parse(setupText('address', state, 'nod_mcp_abc')), {
      mcpServers: {
        nod: {
          type: 'http',
          url: 'http://127.0.0.1:47823/mcp',
          headers: { Authorization: 'Bearer nod_mcp_abc' },
        },
      },
    });
  });
});
