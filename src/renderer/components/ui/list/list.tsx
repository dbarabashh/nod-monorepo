import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../cx.ts';

export function List({ className, ...props }: ComponentProps<'ul'>) {
  return <ul className={cx('ui-list', className)} {...props} />;
}

type ListRowProps = ComponentProps<'button'> & {
  selected?: boolean;
  action?: ReactNode;
};

export function ListRow({
  selected = false,
  action,
  className,
  type = 'button',
  ...props
}: ListRowProps) {
  return (
    <li className="ui-list__item">
      <button
        type={type}
        className={cx('ui-list__row', className)}
        aria-current={selected ? 'true' : undefined}
        {...props}
      />
      {action && <span className="ui-list__action">{action}</span>}
    </li>
  );
}
