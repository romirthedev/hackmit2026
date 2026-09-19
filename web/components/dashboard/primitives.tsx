'use client';
/* oxlint-disable next/no-img-element -- avatars are remote SVGs */
import type { ReactNode, CSSProperties, ButtonHTMLAttributes } from 'react';
import { ArrowUpRight } from 'lucide-react';

export function Cell({
  label,
  children,
  wide,
  link,
  index = 0,
  className = '',
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  link?: boolean;
  index?: number;
  className?: string;
}) {
  return (
    <section
      className={`cell ${wide ? 'wide' : ''} ${className}`}
      style={{ '--i': index } as CSSProperties}
    >
      <div className="label">
        {label}
        {link && <ArrowUpRight className="label-icon" />}
      </div>
      {children}
    </section>
  );
}

export function Card({
  children,
  className = '',
  style,
  ...rest
}: { children: ReactNode; className?: string; style?: CSSProperties } & Record<
  string,
  unknown
>) {
  return (
    <article className={`card ${className}`} style={style} {...rest}>
      {children}
    </article>
  );
}

export function Row({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`row ${className}`}>{children}</div>;
}

export function Btn({
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type="button" className={`btn ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Avatar({
  src,
  size = 46,
  className = '',
}: {
  src: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={`thumb ${className}`}
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}

export function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function ago(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function hm(time: number, zone?: string) {
  return new Date(time * 1000).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: zone,
  });
}
