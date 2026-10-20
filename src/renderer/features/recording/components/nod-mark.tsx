import type { ComponentProps } from 'react';

export function NodMark(props: Omit<ComponentProps<'svg'>, 'children'>) {
  return (
    <svg viewBox="110 40 270 240" fill="currentColor" aria-hidden {...props}>
      <path d="M110 280V145C110 82 163 40 245 40C327 40 380 82 380 145V280H286V150C286 116 270 96 245 96C220 96 204 116 204 150V280H110Z" />
    </svg>
  );
}
