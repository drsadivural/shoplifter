// Basic building blocks: Button, ButtonLink, Card, StatCard, Badge/StatusPill, Notice, Tabs, Spinner.
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { useI18n } from '../i18n';
import { Icon, type IconName } from './Icon';

// ------------------------------------------------------------------ Button

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  /** Shows a spinner, sets aria-busy and blocks clicks (button stays focusable). */
  pending?: boolean;
  icon?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', pending = false, icon, className, children, type = 'button', onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`btn btn-${variant} btn-${size} ${className ?? ''}`}
      aria-busy={pending || undefined}
      onClick={pending ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {pending ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  icon,
  children,
  ...rest
}: LinkProps & { variant?: ButtonVariant; size?: 'md' | 'sm'; icon?: IconName }) {
  return (
    <Link className={`btn btn-${variant} btn-${size} ${className ?? ''}`} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

// ------------------------------------------------------------------ Card

export interface CardProps {
  title?: ReactNode;
  /** Small element next to the title (e.g. a Badge). */
  titleAddon?: ReactNode;
  /** Right-aligned header actions. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Heading level for the title (default h2). */
  headingLevel?: 2 | 3;
  id?: string;
}

export function Card({ title, titleAddon, actions, children, className, headingLevel = 2, id }: CardProps) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  const headingId = useId();
  return (
    <section className={`card ${className ?? ''}`} aria-labelledby={title ? headingId : undefined} id={id}>
      {title || actions ? (
        <div className="card-head">
          {title ? (
            <H id={headingId} className="card-title">
              {title} {titleAddon}
            </H>
          ) : (
            <span />
          )}
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ StatCard

export interface StatCardProps {
  label: string;
  /** null/undefined = source unavailable (rendered as "—" + "Unavailable"), distinct from 0. */
  value: ReactNode | null | undefined;
  caption?: ReactNode;
  /** Explains why the value is unavailable (shown under the dash). */
  unavailableReason?: string;
  /** Optional link to the filtered records behind the metric. */
  to?: string;
}

export function StatCard({ label, value, caption, unavailableReason, to }: StatCardProps) {
  const { t } = useI18n();
  const unavailable = value === null || value === undefined;
  const body = (
    <>
      <div className="stat-label">{label}</div>
      {unavailable ? (
        <div className="stat-num stat-unavailable" data-testid="stat-unavailable">
          <span aria-hidden="true">—</span>
          <span className="visually-hidden">{t('Unavailable')}</span>
        </div>
      ) : (
        <div className="stat-num">{value}</div>
      )}
      <div className="stat-caption">
        {unavailable ? (
          <>
            <Badge tone="neutral">{t('Unavailable')}</Badge> {unavailableReason ? <span>{unavailableReason}</span> : null}
          </>
        ) : (
          caption
        )}
      </div>
    </>
  );
  return to && !unavailable ? (
    <Link to={to} className="card stat-card stat-link">
      {body}
    </Link>
  ) : (
    <div className="card stat-card">{body}</div>
  );
}

// ------------------------------------------------------------------ Badge / StatusPill

export type Tone = 'neutral' | 'ok' | 'info' | 'warning' | 'critical';

/** Small label. Always carries text — color is never the only signal. */
export function Badge({ tone = 'info', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

const TONE_GLYPH: Record<Tone, string> = { neutral: '○', ok: '●', info: '◆', warning: '▲', critical: '■' };

/** Status pill: glyph + text + color. Use for states (ready, offline, pending...). */
export function StatusPill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone} status-pill`} title={title}>
      <span aria-hidden="true" className="status-glyph">
        {TONE_GLYPH[tone]}
      </span>
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ Notice

/** Inline note with a colored left rule (e.g. "AI signals require review..."). */
export function Notice({ tone = 'warning', children, title }: { tone?: 'warning' | 'info' | 'critical'; children: ReactNode; title?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`}>
      {title ? <strong className="notice-title">{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ Tabs (filter tabs)

export interface TabItem<V extends string> {
  value: V;
  label: string;
  count?: number;
}

/** Segmented filter tabs (a radio group semantically: one active value). */
export function FilterTabs<V extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div className="filter-tabs" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className={`filter-tab ${it.value === value ? 'active' : ''}`}
          aria-pressed={it.value === value}
          onClick={() => onChange(it.value)}
        >
          {it.label}
          {typeof it.count === 'number' ? <span className="filter-tab-count">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Key/value rows (definition list). */
export function KeyValueList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((it, i) => (
        <div className="kv-row" key={i}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
