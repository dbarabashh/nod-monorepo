import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon.tsx';

type EmptyStateProps = {
  icon: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="ui-empty-state">
      <span className="ui-empty-state__icon">
        <Icon name={icon} />
      </span>
      <p className="ui-empty-state__title">{title}</p>
      {description && (
        <p className="ui-empty-state__description">{description}</p>
      )}
      {action}
    </div>
  );
}
