import { useEffect } from 'react';
import { audioSources } from '../../../shared/ipc.ts';
import { Button, EmptyState } from '../../components/ui/index.ts';
import {
  getAudioAccess,
  openAudioSettings,
  requestMicrophoneAccess,
} from './api.ts';
import { useAsync } from '../../lib/use-async.ts';
import { AudioSourceRow } from './components/audio-source-row.tsx';
import './audio-access.css';

export function AudioAccessPanel() {
  const { state, setState, retry, refresh, track } = useAsync(getAudioAccess);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  function request() {
    track(
      requestMicrophoneAccess().then((value) =>
        setState({ status: 'ready', value }),
      ),
    );
  }

  if (state.status === 'loading') {
    return <p className="audio-access__note">Checking access…</p>;
  }

  if (state.status === 'error') {
    return (
      <EmptyState
        icon="mic"
        title="Couldn't check audio access"
        action={<Button onClick={retry}>Try again</Button>}
      />
    );
  }

  return (
    <div className="audio-access">
      {audioSources.map((source) => (
        <AudioSourceRow
          key={`${source}:${state.value[source].status}`}
          source={source}
          access={state.value[source]}
          onRequest={request}
          onOpenSettings={() => track(openAudioSettings(source))}
        />
      ))}
    </div>
  );
}
