import { isAppUrl } from './navigation.ts';

type MediaPermissionRequest = {
  permission: string;
  requestingUrl: string;
  isMainFrame: boolean;
  mediaTypes: readonly string[];
};

export function isAllowedPermissionRequest(
  request: MediaPermissionRequest,
  appUrl: string,
  passScreenCapture: () => boolean,
): boolean {
  return (
    request.permission === 'media' &&
    request.isMainFrame &&
    isAppUrl(request.requestingUrl, appUrl) &&
    (request.mediaTypes.length === 0
      ? passScreenCapture()
      : request.mediaTypes.every((type) => type === 'audio'))
  );
}

type MediaPermissionCheck = {
  permission: string;
  requestingUrl: string;
  isMainFrame: boolean;
  mediaType: string | undefined;
};

export function isAllowedPermissionCheck(
  check: MediaPermissionCheck,
  appUrl: string,
): boolean {
  return (
    check.permission === 'media' &&
    check.isMainFrame &&
    check.mediaType === 'audio' &&
    isAppUrl(check.requestingUrl, appUrl)
  );
}

export type DisplayMediaRequest = {
  audioRequested: boolean;
  userGesture: boolean;
  isMainFrame: boolean;
  frameUrl: string | undefined;
};

export function isAllowedDisplayMediaRequest(
  request: DisplayMediaRequest,
  appUrl: string,
): boolean {
  return (
    request.audioRequested &&
    request.userGesture &&
    request.isMainFrame &&
    request.frameUrl !== undefined &&
    isAppUrl(request.frameUrl, appUrl)
  );
}
