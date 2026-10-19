export function isAppUrl(target: string, appUrl: string): boolean {
  if (!URL.canParse(target) || !URL.canParse(appUrl)) {
    return false;
  }
  const to = new URL(target);
  const app = new URL(appUrl);
  if (app.protocol === 'file:') {
    return (
      to.protocol === 'file:' &&
      to.host === app.host &&
      to.pathname === app.pathname
    );
  }
  return to.origin === app.origin;
}
