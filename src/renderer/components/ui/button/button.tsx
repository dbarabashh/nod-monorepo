import type { ComponentProps } from 'react';
import { cx } from '../cx.ts';

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'default' | 'primary' | 'danger' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
};

export function Button({
  variant = 'default',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-button', className)}
      data-variant={variant === 'default' ? undefined : variant}
      data-size={size === 'md' ? undefined : size}
      {...props}
    />
  );
}
