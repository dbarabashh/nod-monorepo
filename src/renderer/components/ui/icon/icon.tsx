import type { ComponentProps } from 'react';
import { cx } from '../cx.ts';

export type IconName =
  | 'search'
  | 'mic'
  | 'list'
  | 'settings'
  | 'clock'
  | 'calendar'
  | 'speaker'
  | 'download';

const paths: Record<IconName, string> = {
  search: 'M11 11l3 3M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Z',
  mic: 'M8 10a2 2 0 0 0 2-2V4a2 2 0 1 0-4 0v4a2 2 0 0 0 2 2Zm4-2a4 4 0 0 1-8 0m4 4v2',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  settings:
    'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.2-1.7.6a5 5 0 0 0-1.7-1L9.3 1.5H6.7l-.3 1.8a5 5 0 0 0-1.7 1l-1.7-.6-1.3 2.2L3.1 7a5 5 0 0 0 0 2l-1.4 1.1L3 12.3l1.7-.6a5 5 0 0 0 1.7 1l.3 1.8h2.6l.3-1.8a5 5 0 0 0 1.7-1l1.7.6 1.3-2.2L12.9 9a5 5 0 0 0 .1-1Z',
  clock: 'M8 4.5V8l2.5 1.5M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z',
  calendar:
    'M2.5 6.5h11M5 1.5v2M11 1.5v2M3.5 3h9a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z',
  download: 'M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11',
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
