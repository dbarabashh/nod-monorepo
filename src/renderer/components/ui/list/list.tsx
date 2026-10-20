import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../cx.ts';

export function List({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cx('ui-list', className)} {...props} />;
}

type ListRowProps = ComponentProps<'button'> & {
  action?: ReactNode;
  trailing?: ReactNode;
};

export function ListRow({
  action,
  trailing,
  className,
  type = 'button',
  children,
  ...props
}: ListRowProps) {
  return (
    <li className="ui-list__item">
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
