import { nativeTheme, screen, type BrowserWindow } from 'electron';
import { openFloatingPanel } from './floating-panel.ts';

const width = 344;
const height = 64;
const margin = 16;

export function openSuggestionWindow(appUrl: string): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  return openFloatingPanel(appUrl, {
    hash: 'suggestion',
    width,
    height,
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + margin,
    // --color-surface
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181c' : '#ffffff',
  });
}
