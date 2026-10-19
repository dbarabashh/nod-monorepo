import type { ComponentProps } from 'react';
import { cx } from '../cx.ts';
import { Icon, type IconName } from '../icon/icon.tsx';

type InputGroupProps = ComponentProps<'input'> & {
  icon: IconName;
};

export function InputGroup({ icon, className, ...props }: InputGroupProps) {
  return (
    <span className="ui-input-group">
      <Icon name={icon} className="ui-input-group__icon" />
      <input className={cx('ui-input', className)} {...props} />
    </span>
  );
}
