import type { ComponentProps } from 'react';
import { cx } from '../cx.ts';

export function Meter({ className, ...props }: ComponentProps<'meter'>) {
  return <meter className={cx('ui-meter', className)} {...props} />;
}
