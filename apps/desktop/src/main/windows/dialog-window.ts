import type { BrowserWindow } from 'electron';
import type { Question } from '../sync/dialog-gate.ts';
import {
  answerOf,
  dialogHeight,
  dialogPage,
  dialogScheme,
  dialogWidth,
} from './dialog-page.ts';
import { openPage } from './page-window.ts';

const margin = 48;

// Every question sync or sharing asks, drawn by main in a window of its own
// over the app, which a page script can't read or click through. The answer
// arrives as the form's navigation to the dialog's own scheme; Escape or
// closing the window is a Cancel.
export function showDialogWindow(
  question: Question,
  parent: BrowserWindow | null,
  onChange: (open: boolean) => void,
): Promise<boolean> {
  // No taller than the window it covers, and over its middle: macOS attaches
  // it as a sheet, the other platforms put it where they are told.
  const over = parent?.getBounds();
  const height = over
    ? Math.min(dialogHeight(question), over.height - margin)
    : dialogHeight(question);
  let answer = false;
  const { window, closed } = openPage({
    partition: 'nod-dialog',
    scheme: dialogScheme,
    html: dialogPage(question),
    // Words of a phrase must stay out of screenshots and a shared screen;
    // a code is there to be compared, and may be shown.
    protect: question.words !== undefined,
    window: {
      width: dialogWidth,
      height,
      x: over ? Math.round(over.x + (over.width - dialogWidth) / 2) : undefined,
      y: over ? Math.round(over.y + (over.height - height) / 2) : undefined,
      title: question.message,
      parent: parent ?? undefined,
      modal: true,
      frame: false,
    },
    onNavigate: (url) => {
      const answered = answerOf(url);
      if (answered !== null) {
        answer = answered;
        window.close();
      }
    },
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault();
      window.close();
    }
  });
  onChange(true);
  return closed.then(() => {
    onChange(false);
    return answer;
  });
}
