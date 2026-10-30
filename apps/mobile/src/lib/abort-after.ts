// Not cleared when the reply arrives: it also has to stop a body that never
// finishes, which is read after fetch returns. Aborting a finished request
// does nothing.
export function abortAfter(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}
