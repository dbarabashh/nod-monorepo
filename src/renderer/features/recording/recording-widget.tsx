import { useEffect, useState } from 'react';
import { onRecordingLevel, showMainWindow, pauseRecording } from './api.ts';
import { formatClock } from '../../lib/format-clock.ts';
import { useElapsed, useRecording } from './use-recording.ts';
import './recording.css';

const barScale = [0.6, 1, 0.75];

export function RecordingWidget() {
  const recording = useRecording();
  const elapsed = useElapsed(recording);
  const [level, setLevel] = useState(0);

  useEffect(() => onRecordingLevel(setLevel), []);

  return (
    <main className="recording-widget">
      <button
        type="button"
        className="recording-widget__stop"
        onClick={() => void pauseRecording()}
        aria-label="Pause recording"
        title="Pause recording"
      >
        <span className="recording-widget__pause-icon" aria-hidden>
          <span />
          <span />
        </span>
      </button>
      <time className="recording-widget__clock">{formatClock(elapsed)}</time>
      <button
        type="button"
        className="recording-widget__open"
        onClick={() => void showMainWindow()}
        aria-label="Open the app"
        title="Open the app"
      >
        {barScale.map((scale, index) => (
          <span
            key={index}
            className="recording-widget__bar"
            style={{ transform: `scaleY(${Math.max(0.15, level * scale)})` }}
          />
        ))}
      </button>
    </main>
  );
}
