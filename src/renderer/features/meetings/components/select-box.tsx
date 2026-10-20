import { useEffect, useRef } from 'react';
import { Icon } from '../../../components/ui/index.ts';

type SelectBoxProps = {
  label: string;
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

export function SelectBox({
  label,
  checked,
  mixed = false,
  disabled,
  onChange,
}: SelectBoxProps) {
  const input = useRef<HTMLInputElement>(null);

  // A partly selected state exists only as a DOM property, not an attribute.
  useEffect(() => {
    if (input.current) {
      input.current.indeterminate = mixed;
    }
  }, [mixed]);

  return (
    <label className="select-box" title={label}>
      <input
        ref={input}
        type="checkbox"
        className="select-box__input"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="select-box__box" aria-hidden>
        <Icon name="check" />
      </span>
    </label>
  );
}
