import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../cx.ts';

export type Tab<T extends string> = {
  id: T;
  label: string;
  content: ReactNode;
};

type TabsProps<T extends string> = {
  label: string;
  tabs: Tab<T>[];
  selected: T;
  onSelect: (id: T) => void;
  className?: string;
};

export function Tabs<T extends string>({
  label,
  tabs,
  selected,
  onSelect,
  className,
}: TabsProps<T>) {
  const prefix = useId();
  const list = useRef<HTMLDivElement>(null);
  const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];

  function move(event: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((tab) => tab.id === selected);
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    if (step === 0 || !next) {
      return;
    }
    event.preventDefault();
    onSelect(next.id);
    list.current
      ?.querySelector<HTMLButtonElement>(
        `#${CSS.escape(`${prefix}-tab-${next.id}`)}`,
      )
      ?.focus();
  }

  return (
    <div className={cx('ui-tabs', className)}>
      <div
        ref={list}
        role="tablist"
        tabIndex={-1}
        aria-label={label}
        className="ui-tabs__list"
        onKeyDown={move}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${prefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            className="ui-tabs__tab"
            aria-selected={tab.id === current?.id}
            aria-controls={`${prefix}-panel`}
            tabIndex={tab.id === current?.id ? 0 : -1}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`${prefix}-panel`}
        role="tabpanel"
        aria-labelledby={current ? `${prefix}-tab-${current.id}` : undefined}
        className="ui-tabs__panel"
      >
        {current?.content}
      </div>
    </div>
  );
}
