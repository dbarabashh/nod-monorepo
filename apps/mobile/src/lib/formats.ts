export const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const longDateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'short',
});

export const clockFormat = new Intl.DateTimeFormat(undefined, {
  timeStyle: 'short',
});
