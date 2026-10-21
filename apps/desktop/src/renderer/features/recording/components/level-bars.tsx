import { cx } from '../../../components/ui/index.ts';

const barScale = [0.375, 1, 0.5625];

export function LevelBars({
  level,
  live,
  className,
}: {
  level: number;
  live: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx('level-bars', className)}
      data-live={live ? '' : undefined}
      aria-hidden
    >
      {barScale.map((scale, index) => (
        <span
          key={index}
          className="level-bars__bar"
          style={{
            transform: `scaleY(${live ? Math.max(0.25, level * scale) : scale})`,
          }}
        />
      ))}
    </span>
  );
}
