import type { Session } from 'electron';
import type { DisplayCaptureGate } from './display-capture-gate.ts';
import {
  isAllowedDisplayMediaRequest,
  isAllowedPermissionCheck,
  isAllowedPermissionRequest,
} from './permissions.ts';

export function secureSession(
  session: Session,
  appUrl: string,
  displayCapture: DisplayCaptureGate,
): void {
  session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const mediaTypes =
        'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
      callback(
        isAllowedPermissionRequest(
          {
            permission,
            requestingUrl: details.requestingUrl,
            isMainFrame: details.isMainFrame,
            mediaTypes,
          },
          appUrl,
          // Screen capture arrives as `media` with no media type, the same as
          // a legacy desktop getUserMedia call, so only a capture the app
          // announced through the preload (which saw the click) may pass.
          displayCapture.pass,
        ),
      );
    },
  );

  session.setPermissionCheckHandler(
    (_webContents, permission, _origin, details) =>
      isAllowedPermissionCheck(
        {
          permission,
          requestingUrl: details.requestingUrl ?? '',
          isMainFrame: details.isMainFrame,
          mediaType: details.mediaType,
        },
        appUrl,
      ),
  );

  session.setDisplayMediaRequestHandler((request, callback) => {
    const { frame } = request;
    if (
      frame &&
      isAllowedDisplayMediaRequest(
        {
          audioRequested: request.audioRequested,
          userGesture: request.userGesture,
          isMainFrame: frame.parent === null,
          frameUrl: frame.url,
        },
        appUrl,
      )
    ) {
      // The video track is mandatory for getDisplayMedia. Capturing the app's
      // own frame avoids asking for screen recording; the renderer stops it.
      callback({ video: frame, audio: 'loopback' });
    } else {
      callback(null);
    }
  });
}
