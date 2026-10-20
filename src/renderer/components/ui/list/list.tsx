import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../cx.ts';

export function List({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cx('ui-list', className)} {...props} />;
}

type ListRowProps = ComponentProps<'button'> & {
  action?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export function ListRow({
  action,
  leading,
  trailing,
  className,
  type = 'button',
  children,
  ...props
}: ListRowProps) {
  return (
    <li className="ui-list__item">
      {leading != null && <span className="ui-list__leading">{leading}</span>}
      <button type={type} className={cx('ui-list__row', className)} {...props}>
        {children}
        {trailing != null && (
          <span className="ui-list__trailing">{trailing}</span>
        )}
      </button>
      {action && <div className="ui-list__action">{action}</div>}
    </li>
  );
}
