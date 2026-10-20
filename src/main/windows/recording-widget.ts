import { BrowserWindow, screen } from 'electron';
import type { WidgetDragPhase } from '../../shared/ipc.ts';
import { openFloatingPanel } from './floating-panel.ts';

const width = 32;
const height = 64;
const margin = 24;

export function openRecordingWidget(appUrl: string): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  return openFloatingPanel(appUrl, {
    hash: 'widget',
    width,
    height,
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + Math.round((workArea.height - height) / 2),
    // --color-widget-bg
    backgroundColor: '#0c0d10',
  });
}

// The widget has no free area to grab, so the page reports how far the
// pointer moved since it was pressed and the window follows, kept on the
// screen it is dragged to.
export function createWidgetDrag(
  widget: () => BrowserWindow | null,
): (phase: WidgetDragPhase, dx: number, dy: number) => void {
  let origin: { x: number; y: number } | null = null;
  return (phase, dx, dy) => {
    const window = widget();
    if (!window || window.isDestroyed()) {
      origin = null;
      return;
    }
    if (phase === 'start') {
      const [x = 0, y = 0] = window.getPosition();
      origin = { x, y };
      return;
    }
    if (!origin) {
      return;
    }
    const [w = width, h = height] = window.getSize();
    const target = { x: origin.x + dx, y: origin.y + dy };
    const { workArea } = screen.getDisplayNearestPoint(target);
    window.setPosition(
      Math.min(Math.max(target.x, workArea.x), workArea.x + workArea.width - w),
      Math.min(
        Math.max(target.y, workArea.y),
        workArea.y + workArea.height - h,
      ),
    );
  };
}
