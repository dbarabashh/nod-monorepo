import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  dragRecordingWidget,
  onRecordingLevel,
  pauseRecording,
  showMainWindow,
} from './api.ts';
import { NodMark } from './components/nod-mark.tsx';
import './recording.css';

const barScale = [0.375, 1, 0.5625];
const clickSlop = 4;

type Press = { x: number; y: number };

function useWidgetDrag() {
  const press = useRef<Press | null>(null);
  const dragged = useRef(false);

  const end = () => {
    press.current = null;
  };

  // Linux drags the widget by its edges through the compositor instead (see
  // recording.css), since Wayland ignores a window moving itself.
  if (document.documentElement.dataset.platform === 'linux') {
    return {};
  }
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button === 0) {
        press.current = { x: event.screenX, y: event.screenY };
        dragged.current = false;
      }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const start = press.current;
      if (!start) {
        return;
      }
      // A release can go missing (a system gesture mid-press); without the
      // button held the widget must not follow the pointer.
      if ((event.buttons & 1) === 0) {
        end();
        return;
      }
      const dx = event.screenX - start.x;
      const dy = event.screenY - start.y;
      if (!dragged.current) {
        if (Math.hypot(dx, dy) < clickSlop) {
          return;
        }
        dragged.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRecordingWidget('start', 0, 0);
      }
      dragRecordingWidget('move', dx, dy);
    },
    onPointerUp: end,
    onLostPointerCapture: end,
    onPointerCancel: () => {
      end();
      dragged.current = false;
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (dragged.current && event.detail > 0) {
        dragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}

export function RecordingWidget() {
  const [level, setLevel] = useState(0);
  const drag = useWidgetDrag();

  useEffect(() => onRecordingLevel(setLevel), []);

  return (
    <main className="recording-widget" {...drag}>
      <button
        type="button"
        className="recording-widget__open"
        onClick={() => void showMainWindow()}
        aria-label="Open the app"
        title="Open the app"
      >
        <NodMark className="recording-widget__mark" />
      </button>
      <button
        type="button"
        className="recording-widget__pause"
        onClick={() => void pauseRecording()}
        aria-label="Pause recording"
        title="Pause recording"
      >
        <span className="recording-widget__level" aria-hidden>
          {barScale.map((scale, index) => (
            <span
              key={index}
              className="recording-widget__bar"
              style={{ transform: `scaleY(${Math.max(0.25, level * scale)})` }}
            />
          ))}
        </span>
        <span className="recording-widget__pause-icon" aria-hidden>
          <span />
          <span />
        </span>
      </button>
    </main>
  );
}
