import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import {
  parseHelperLine,
  parsePactl,
  parseRegistry,
  type MicUse,
} from './parse.ts';

export type MicMonitor = (onChange: (use: MicUse) => void) => () => void;

const registryKey =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const registryIntervalMs = 3_000;
const pactlSettleMs = 250;
const firstRestartMs = 5_000;
const lastRestartMs = 60_000;

// pactl translates its output, and only the English form can be read.
const pactlEnv = { ...process.env, LC_ALL: 'C' };

// Windows runs a bare program name from the working directory first, so the
// system's own copy is named in full.
const reg = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'reg.exe',
);

function query(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 5_000, maxBuffer: 1024 * 1024, windowsHide: true, env },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}

// A watcher that exits (the audio server restarted, the helper crashed) is
// started again, waiting longer each time it keeps failing; one whose program
// isn't there at all is not tried again.
export function respawning(
  run: (
    onChange: (use: MicUse) => void,
    onExit: (missing: boolean) => void,
  ) => () => void,
): MicMonitor {
  return (onChange) => {
    let stopped = false;
    let delay = firstRestartMs;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let kill = () => {};
    const start = () => {
      const startedAt = Date.now();
      let exited = false;
      kill = run(onChange, (missing) => {
        if (stopped || exited) {
          return;
        }
        exited = true;
        kill();
        onChange(null);
        if (missing) {
          return;
        }
        if (Date.now() - startedAt > lastRestartMs) {
          delay = firstRestartMs;
        }
        timer = setTimeout(start, delay);
        delay = Math.min(delay * 2, lastRestartMs);
      });
    };
    start();
    return () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      kill();
    };
  };
}

// macOS: the helper reports each change as CoreAudio announces it.
export function helperMonitor(binary: string): MicMonitor {
  return respawning((onChange, onExit) => {
    const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    child.on('error', (error) => onExit(isMissing(error)));
    child.on('exit', () => onExit(false));
    createInterface({ input: child.stdout }).on('line', (line) => {
      const use = parseHelperLine(line);
      if (use !== undefined) {
        onChange(use);
      }
    });
    return () => child.kill();
  });
}

// Linux: PulseAudio and PipeWire announce every new or closed recording
// stream; the list is read again once the events settle.
export function pactlMonitor(): MicMonitor {
  return respawning((onChange, onExit) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const read = () => {
      timer = null;
      query('pactl', ['list', 'source-outputs'], pactlEnv).then(
        (text) => !stopped && onChange(parsePactl(text)),
        () => !stopped && onChange(null),
      );
    };
    const child = spawn('pactl', ['subscribe'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: pactlEnv,
    });
    child.on('error', (error) => onExit(isMissing(error)));
    child.on('exit', () => onExit(false));
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.includes('source-output') && timer === null) {
        timer = setTimeout(read, pactlSettleMs);
      }
    });
    read();
    return () => {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      child.kill();
    };
  });
}

// Windows announces microphone use only to native code, so the record it
// keeps of which apps use the microphone is read every few seconds.
export function registryMonitor(): MicMonitor {
  return (onChange) => {
    let stopped = false;
    let reading = false;
    const read = () => {
      if (reading) {
        return;
      }
      reading = true;
      query(reg, ['query', registryKey, '/s'])
        .then(
          (text) => !stopped && onChange(parseRegistry(text)),
          () => !stopped && onChange(null),
        )
        .finally(() => {
          reading = false;
        });
    };
    const timer = setInterval(read, registryIntervalMs);
    read();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  };
}

export function platformMonitor(helper: string | null): MicMonitor | null {
  switch (process.platform) {
    case 'darwin':
      return helper ? helperMonitor(helper) : null;
    case 'linux':
      return pactlMonitor();
    case 'win32':
      return registryMonitor();
    default:
      return null;
  }
}
