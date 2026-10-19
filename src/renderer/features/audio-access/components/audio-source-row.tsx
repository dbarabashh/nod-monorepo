import { useEffect, useId, useRef, useState } from 'react';
import type { AudioSource, AudioSourceAccess } from '../../../../shared/ipc.ts';
import { Button, Icon, Meter } from '../../../components/ui/index.ts';
import { CaptureError, monitorLevel, type LevelMonitor } from '../capture.ts';
import { describeSource, type TestOutcome } from '../lib/source-state.ts';

type AudioSourceRowProps = {
  source: AudioSource;
  access: AudioSourceAccess;
  onRequest: () => void;
  onOpenSettings: () => void;
};

const copy: Record<
  AudioSource,
  { title: string; hint: string; testHint: string }
> = {
  microphone: {
    title: 'Microphone',
    hint: 'Your side of the conversation.',
    testHint: 'Say something to see the level.',
  },
  'system-audio': {
    title: 'System audio',
    hint: 'Other participants, captured from your computer without a bot joining the call.',
    testHint: 'Play some sound to see the level.',
  },
};

export function AudioSourceRow({
  source,
  access,
  onRequest,
  onOpenSettings,
}: AudioSourceRowProps) {
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome>(null);
  const run = useRef<object | null>(null);
  const monitor = useRef<LevelMonitor | null>(null);
  const meter = useRef<HTMLMeterElement>(null);
  const view = describeSource(source, access, outcome);
  const titleId = useId();

  function release() {
    run.current = null;
    monitor.current?.stop();
    monitor.current = null;
  }

  useEffect(() => release, []);

  async function startTest() {
    release();
    const current = {};
    run.current = current;
    setOutcome(null);
    setTesting(true);
    try {
      const started = await monitorLevel(
        source,
        (level) => {
          if (meter.current) {
            meter.current.value = level;
          }
        },
        () => {
          if (run.current === current) {
            release();
            setTesting(false);
            setOutcome('interrupted');
          }
        },
      );
      if (run.current !== current) {
        started.stop();
        return;
      }
      monitor.current = started;
      setOutcome('working');
    } catch (error) {
      if (run.current === current) {
        setTesting(false);
        setOutcome(error instanceof CaptureError ? error.failure : 'failed');
      }
    }
  }

  function stopTest() {
    release();
    setTesting(false);
  }

  return (
    <section className="audio-source" aria-labelledby={titleId}>
      <span className="audio-source__icon">
        <Icon name={source === 'microphone' ? 'mic' : 'speaker'} />
      </span>
      <div className="audio-source__body">
        <h3 id={titleId} className="audio-source__title">
          {copy[source].title}
        </h3>
        <p className="audio-source__hint">{copy[source].hint}</p>
        <output
          className="audio-source__status"
          data-attention={view.attention || undefined}
        >
          {view.message}
        </output>
        {testing && (
          <div className="audio-source__meter">
            <Meter ref={meter} aria-label={`${copy[source].title} level`} />
            <p className="audio-source__hint">{copy[source].testHint}</p>
          </div>
        )}
      </div>
      <div className="audio-source__actions">
        {view.canRequest && (
          <Button variant="primary" onClick={onRequest}>
            Allow access
          </Button>
        )}
        {view.canOpenSettings && (
          <Button onClick={onOpenSettings}>Open settings</Button>
        )}
        {testing ? (
          <Button variant="outline" onClick={stopTest}>
            Stop
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={startTest}
            disabled={view.canRequest}
          >
            Test
          </Button>
        )}
      </div>
    </section>
  );
}
