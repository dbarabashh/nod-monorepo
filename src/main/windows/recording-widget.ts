import { BrowserWindow, screen } from 'electron';
import type { WidgetDragPhase } from '../../shared/ipc.ts';
import path from 'node:path';
import { secureWindow } from '../security/window.ts';

const width = 32;
const height = 64;
const margin = 24;

export function openRecordingWidget(appUrl: string): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const widget = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + Math.round((workArea.height - height) / 2),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    // Matches --color-widget-bg, so the window never flashes another colour.
    backgroundColor: '#0c0d10',
    hasShadow: true,
    // macOS: the panel never becomes the key window, so without this the
    // press that should start a drag or hit a button only focuses it.
    acceptFirstMouse: true,
    // macOS: a panel floats over full-screen apps without stealing focus.
    // Windows: a toolbar window stays out of Alt+Tab.
    type:
      process.platform === 'darwin'
        ? 'panel'
        : process.platform === 'win32'
          ? 'toolbar'
          : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      backgroundThrottling: false,
    },
  });
  widget.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'darwin') {
    widget.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
  }
  secureWindow(widget.webContents, appUrl);
  widget.once('ready-to-show', () => widget.showInactive());
  void widget.loadURL(`${appUrl}#widget`);
  return widget;
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
