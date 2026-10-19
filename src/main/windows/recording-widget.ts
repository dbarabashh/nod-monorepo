import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { secureWindow } from '../security/window.ts';

const width = 56;
const height = 112;
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
