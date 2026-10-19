import type { ComponentProps } from 'react';
import { cx } from '../cx.ts';
import { Icon, type IconName } from '../icon/icon.tsx';

export function Nav({ className, ...props }: ComponentProps<'nav'>) {
  return <nav className={cx('ui-nav', className)} {...props} />;
}

type NavItemProps = ComponentProps<'button'> & {
  icon: IconName;
  current?: boolean;
};

export function NavItem({
  icon,
  current = false,
  className,
  children,
  type = 'button',
  ...props
}: NavItemProps) {
  return (
    <button
      type={type}
      className={cx('ui-nav-item', className)}
      aria-current={current ? 'page' : undefined}
      {...props}
    >
      <Icon name={icon} />
      <span className="ui-nav-item__label">{children}</span>
    </button>
  );
}
