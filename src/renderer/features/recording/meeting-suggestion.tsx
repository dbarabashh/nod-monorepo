import { useEffect, useEffectEvent, useState } from 'react';
import { Button, Icon } from '../../components/ui/index.ts';
import type { MeetingSuggestion as Suggestion } from '../../../shared/ipc.ts';
import { useAsync } from '../../lib/use-async.ts';
import {
  dismissMeetingSuggestion,
  getMeetingSuggestion,
  onMeetingSuggestion,
  showMainWindow,
  startRecording,
} from './api.ts';
import { useStart } from './components/use-start.ts';
import './recording.css';

// Matches --duration-suggestion, which runs the bar that shows it.
const showForMs = 15_000;
const tickMs = 250;

// Counts down while nobody is looking at the card; pointing at it or moving
// focus into it holds the countdown, so reading never loses it. The window is
// the card, so the whole page is checked.
function useCountdown(running: boolean, onDone: () => void) {
  const finish = useEffectEvent(onDone);

  useEffect(() => {
    if (!running) {
      return;
    }
    const page = document.documentElement;
    let remaining = showForMs;
    const timer = setInterval(() => {
      const looking =
        page.matches(':hover') ||
        (document.activeElement !== null &&
          document.activeElement !== document.body);
      page.dataset.held = String(looking);
      if (!looking) {
        remaining -= tickMs;
      }
      if (remaining <= 0) {
        clearInterval(timer);
        finish();
      }
    }, tickMs);
    return () => clearInterval(timer);
  }, [running]);
}

export function MeetingSuggestion() {
  const { state } = useAsync(getMeetingSuggestion, onMeetingSuggestion);
  const suggestion = state.status === 'ready' ? state.value : null;

  // Each suggestion is a card of its own, with its own countdown and choices.
  return suggestion ? (
    <SuggestionCard
      key={`${suggestion.appName}:${suggestion.title}`}
      suggestion={suggestion}
    />
  ) : null;
}

function SuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const [choosing, setChoosing] = useState(false);
  const [recording, setRecording] = useState(false);
  const { start, starting, notice } = useStart();

  const dismiss = (quietApp: boolean) =>
    void dismissMeetingSuggestion(quietApp).catch(() => undefined);
  useCountdown(!starting && !recording && notice === null, () =>
    dismiss(false),
  );

  const takeNotes = () =>
    void start(async () => {
      await startRecording(suggestion.title);
      setRecording(true);
    });

  return (
    <section
      className="meeting-suggestion"
      aria-label="Meeting detected"
      data-counting={!starting && !recording && notice === null}
    >
      <img
        className="meeting-suggestion__icon"
        src="app-icon.png"
        alt=""
        draggable={false}
      />
      <div className="meeting-suggestion__text">
        <p className="meeting-suggestion__title">Meeting detected</p>
        <p className="meeting-suggestion__detail" title={notice ?? undefined}>
          {notice ?? suggestion.appName}
        </p>
      </div>
      {notice ? (
        <div className="meeting-suggestion__actions">
          <Button size="sm" onClick={() => void showMainWindow()}>
            Open Nod
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Close"
            onClick={() => dismiss(false)}
          >
            <Icon name="close" />
          </Button>
        </div>
      ) : choosing ? (
        <div className="meeting-suggestion__actions">
          <Button size="sm" variant="ghost" onClick={() => dismiss(false)}>
            Skip
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={`Never suggest taking notes for ${suggestion.appName}`}
            onClick={() => dismiss(true)}
          >
            Always skip
          </Button>
        </div>
      ) : (
        <div className="meeting-suggestion__quick">
          <button
            type="button"
            className="meeting-suggestion__take"
            disabled={starting}
            onClick={takeNotes}
          >
            {starting ? 'Starting…' : 'Take notes'}
          </button>
          <button
            type="button"
            className="meeting-suggestion__more"
            aria-label="More options"
            disabled={starting}
            onClick={() => setChoosing(true)}
          >
            <Icon name="chevron-down" />
          </button>
        </div>
      )}
      <span className="meeting-suggestion__track" aria-hidden>
        <span className="meeting-suggestion__fill" />
      </span>
    </section>
  );
}
