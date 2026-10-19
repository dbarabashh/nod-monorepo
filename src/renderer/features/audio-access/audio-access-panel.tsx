import { useCallback, useEffect, useState } from 'react';
import { audioSources, type AudioAccess } from '../../../shared/ipc.ts';
import { Button, EmptyState } from '../../components/ui/index.ts';
import {
  getAudioAccess,
  openAudioSettings,
  requestMicrophoneAccess,
} from './api.ts';
import { AudioSourceRow } from './components/audio-source-row.tsx';
import './audio-access.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; access: AudioAccess };

export function AudioAccessPanel() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const show = useCallback((access: Promise<AudioAccess>) => {
    access.then(
      (value) => setState({ status: 'ready', access: value }),
      () => setState({ status: 'error' }),
    );
  }, []);

  const load = useCallback(() => show(getAudioAccess()), [show]);

  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  function request() {
    show(requestMicrophoneAccess());
  }

  if (state.status === 'loading') {
    return <p className="audio-access__note">Checking access…</p>;
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        icon="mic"
        title="Couldn't check audio access"
        action={
          <Button
            onClick={() => {
              setState({ status: 'loading' });
              load();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="audio-access">
      {audioSources.map((source) => (
        <AudioSourceRow
          key={`${source}:${state.access[source].status}`}
          source={source}
          access={state.access[source]}
          onRequest={request}
          onOpenSettings={() => {
            openAudioSettings(source).catch(() =>
              setState({ status: 'error' }),
            );
          }}
        />
      ))}
    </div>
  );
}
