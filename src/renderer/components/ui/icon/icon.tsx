import type { ComponentProps } from 'react';
import { cx } from '../cx.ts';

export type IconName =
  | 'search'
  | 'mic'
  | 'list'
  | 'settings'
  | 'clock'
  | 'speaker'
  | 'download'
  | 'copy'
  | 'check'
  | 'sync'
  | 'key'
  | 'transcript'
  | 'summary'
  | 'trash'
  | 'document'
  | 'home'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'folder'
  | 'folder-plus'
  | 'more'
  | 'pencil'
  | 'plus'
  | 'close';

const paths: Record<IconName, string> = {
  search: 'M11 11l3 3M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Z',
  mic: 'M8 10a2 2 0 0 0 2-2V4a2 2 0 1 0-4 0v4a2 2 0 0 0 2 2Zm4-2a4 4 0 0 1-8 0m4 4v2',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  settings:
    'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.2-1.7.6a5 5 0 0 0-1.7-1L9.3 1.5H6.7l-.3 1.8a5 5 0 0 0-1.7 1l-1.7-.6-1.3 2.2L3.1 7a5 5 0 0 0 0 2l-1.4 1.1L3 12.3l1.7-.6a5 5 0 0 0 1.7 1l.3 1.8h2.6l.3-1.8a5 5 0 0 0 1.7-1l1.7.6 1.3-2.2L12.9 9a5 5 0 0 0 .1-1Z',
  clock: 'M8 4.5V8l2.5 1.5M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z',
  download: 'M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11',
  copy: 'M5.5 5.5V3a1 1 0 0 1 1-1H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-2.5M3 5.5h6.5a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z',
  check: 'M3 8.5 6.5 12 13 4.5',
  sync: 'M2.5 8a5.5 5.5 0 0 1 9.4-3.9l1.6 1.4M13.5 2.5v3h-3M13.5 8a5.5 5.5 0 0 1-9.4 3.9l-1.6-1.4M2.5 13.5v-3h3',
  key: 'M4.5 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 8h7.5M12.5 8v2.5M14.5 8v2',
  transcript: 'M3 4h10M3 7h10M3 10h7M3 13h4',
  trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5',
  summary: 'M8 1.5 9.4 6.6 14.5 8l-5.1 1.4L8 14.5 6.6 9.4 1.5 8l5.1-1.4L8 1.5Z',
  document:
    'M9 2H4.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.5L9 2Zm0 0v3.5h3.5',
  home: 'M2.5 7.5 8 3l5.5 4.5M4 6.5V13h3V10h2v3h3V6.5',
  'chevron-left': 'M10 3.5 5.5 8l4.5 4.5',
  'chevron-right': 'M6 3.5 10.5 8 6 12.5',
  'chevron-down': 'M3.5 6 8 10.5 12.5 6',
  folder:
    'M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5Z',
  'folder-plus':
    'M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5ZM8 7.5v3M6.5 9h3',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  plus: 'M8 3v10M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  pencil: 'M10.5 3 13 5.5 6 12.5H3.5V10L10.5 3Z',
  speaker:
    'M2 6v4h2.5L8 13V3L4.5 6H2ZM10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9',
};

type IconProps = Omit<ComponentProps<'svg'>, 'children'> & {
  name: IconName;
  label?: string;
};

export function Icon({ name, label, className, ...props }: IconProps) {
  return (
    <svg
      className={cx('ui-icon', className)}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
