import type { ComponentProps } from 'react';
import { cx } from '../cx.ts';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cx('ui-card', className)} {...props} />;
}

export function CardMedia({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cx('ui-card__media', className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('ui-card__body', className)} {...props} />;
}

export function CardHeading({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('ui-card__heading', className)} {...props} />;
}

export function CardTitle({
  className,
  children,
  ...props
}: ComponentProps<'h3'>) {
  return (
    <h3 className={cx('ui-card__title', className)} {...props}>
      {children}
    </h3>
  );
}

export function CardText({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cx('ui-card__text', className)} {...props} />;
}

type CardMetaProps = ComponentProps<'p'> & {
  variant?: 'muted' | 'strong' | 'danger';
};

export function CardMeta({ variant, className, ...props }: CardMetaProps) {
  return (
    <p
      className={cx('ui-card__meta', className)}
      data-variant={variant === 'muted' ? undefined : variant}
      {...props}
    />
  );
}

export function CardDetail({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('ui-card__detail', className)} {...props} />;
}

export function CardActions({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('ui-card__actions', className)} {...props} />;
}
