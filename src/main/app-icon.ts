import { app, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png');
}

export function windowIcon(): BrowserWindowConstructorOptions['icon'] {
  // Packaged Windows and macOS builds carry the icon in the executable and
  // bundle; Linux windows and unpackaged Windows runs take it from here.
  if (
    process.platform === 'linux' ||
    (process.platform === 'win32' && !app.isPackaged)
  ) {
    return iconPath();
  }
  return undefined;
}
