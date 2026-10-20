import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from 'react';
import { cx, Icon, type IconName } from '../../../components/ui/index.ts';

export function Popover({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      popover="auto"
      role="dialog"
      className={cx('menu-popover', className)}
      {...props}
    />
  );
}

export function usePopoverOpen(popover: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = popover.current;
    if (!element) {
      return;
    }
    const toggled = () => setOpen(element.matches(':popover-open'));
    element.addEventListener('toggle', toggled);
    return () => element.removeEventListener('toggle', toggled);
  }, [popover]);

  return open;
}

type PopoverItemProps = ComponentProps<'button'> & {
  icon?: IconName;
  checked?: boolean;
  variant?: 'default' | 'danger' | 'accent';
};

export function PopoverItem({
  icon,
  checked = false,
  variant = 'default',
  className,
  children,
  type = 'button',
  ...props
}: PopoverItemProps) {
  return (
    <button
      type={type}
      className={cx('menu-popover__item', className)}
      data-variant={variant === 'default' ? undefined : variant}
      aria-current={checked ? 'true' : undefined}
      {...props}
    >
      {icon && <Icon name={icon} />}
      <span className="menu-popover__label">{children}</span>
      {checked && <Icon name="check" className="menu-popover__check" />}
    </button>
  );
}

export function PopoverSeparator() {
  return <hr className="menu-popover__separator" />;
}

const confirmWindowMs = 5_000;
// The confirm item appears where the pointer already is, so the second click
// of a double click must not count as the confirmation.
const armDelayMs = 400;

type ConfirmItemsProps = {
  note: string;
  failedNote: string;
  label: string;
  onConfirm: () => Promise<unknown>;
  onCancel: () => void;
};

export function ConfirmItems({
  note,
  failedNote,
  label,
  onConfirm,
  onCancel,
}: ConfirmItemsProps) {
  const noteId = useId();
  const confirm = useRef<HTMLButtonElement>(null);
  const armedAt = useRef(0);
  const expire = useEffectEvent(onCancel);

  useEffect(() => {
    armedAt.current = performance.now();
  }, []);
  const [state, setState] = useState<'ready' | 'working' | 'failed'>('ready');

  useEffect(() => {
    if (state === 'working') {
      return;
    }
    confirm.current?.focus();
    if (state === 'failed') {
      return;
    }
    const timer = setTimeout(expire, confirmWindowMs);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <>
      <p id={noteId} className="menu-popover__note" role="status">
        {state === 'failed' ? failedNote : note}
      </p>
      <PopoverItem
        ref={confirm}
        icon="trash"
        variant="danger"
        aria-describedby={noteId}
        disabled={state === 'working'}
        onKeyDown={(event) => {
          if (event.repeat) {
            event.preventDefault();
          }
        }}
        onClick={() => {
          if (performance.now() - armedAt.current < armDelayMs) {
            return;
          }
          setState('working');
          onConfirm().catch(() => setState('failed'));
        }}
      >
        {state === 'failed' ? 'Try again' : label}
      </PopoverItem>
      <PopoverItem onClick={onCancel}>Cancel</PopoverItem>
    </>
  );
}
