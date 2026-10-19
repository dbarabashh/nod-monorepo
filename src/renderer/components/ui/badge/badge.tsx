import type { ComponentProps } from 'react';
import { cx } from '../cx.ts';

export type BadgeVariant =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger';

type BadgeProps = ComponentProps<'span'> & {
  variant?: BadgeVariant;
  dot?: boolean;
};

export function Badge({
  variant = 'neutral',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cx('ui-badge', className)}
      data-variant={variant}
      {...props}
    >
      {dot && <span className="ui-badge__dot" aria-hidden />}
      {children}
    </span>
  );
}
