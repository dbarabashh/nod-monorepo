export type MicUser = { pid: number | null; id: string };

// null means the microphone is free; an empty list means it is in use by a
// process the system wouldn't name.
export type MicUse = MicUser[] | null;

function pid(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseHelperLine(line: string): MicUse | undefined {
  const [word, ...entries] = line.trim().split(/\s+/);
  if (word === 'idle') {
    return null;
  }
  if (word !== 'active') {
    return undefined;
  }
  return entries.map((entry) => {
    const colon = entry.indexOf(':');
    return colon < 0
      ? { pid: pid(entry), id: '' }
      : { pid: pid(entry.slice(0, colon)), id: entry.slice(colon + 1) };
  });
}

// `pactl list source-outputs`, in the text form every version prints: one
// block per recording stream, its properties quoted.
export function parsePactl(text: string): MicUse {
  const users: MicUser[] = [];
  for (const block of text.split(/^Source Output #/m).slice(1)) {
    if (/^\s*Corked:\s*yes\s*$/m.test(block)) {
      continue;
    }
    const property = (key: string) =>
      new RegExp(`^\\s*${key.replaceAll('.', '\\.')} = "(.*)"\\s*$`, 'm').exec(
        block,
      )?.[1];
    users.push({
      pid: pid(property('application.process.id')),
      id:
        property('application.process.binary') ??
        property('application.name') ??
        '',
    });
  }
  return users.length > 0 ? users : null;
}

// `reg query …\ConsentStore\microphone /s`: Windows records, per app, when
// it last started and stopped using the microphone; a stop time of zero
// after a start means it is using it now.
export function parseRegistry(text: string): MicUse {
  const users: MicUser[] = [];
  for (const block of text.split(/\r?\n(?=HKEY_)/)) {
    const key = block.split(/\r?\n/, 1)[0]?.trim() ?? '';
    const value = (name: string) =>
      new RegExp(`^\\s*${name}\\s+REG_QWORD\\s+(0x[0-9a-f]+)\\s*$`, 'im').exec(
        block,
      )?.[1];
    const started = value('LastUsedTimeStart');
    const stopped = value('LastUsedTimeStop');
    if (started && stopped && BigInt(started) > 0n && BigInt(stopped) === 0n) {
      users.push({ pid: null, id: key.split('\\').at(-1) ?? '' });
    }
  }
  return users.length > 0 ? users : null;
}
