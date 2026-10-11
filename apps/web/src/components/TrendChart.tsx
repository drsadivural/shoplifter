// Simple accessible grouped bar chart (SVG) with a data-table fallback.
import { useId } from 'react';
import { useI18n } from '../i18n';
import { formatMonthDay, formatWeekday } from '../lib/format';

export interface TrendSeries {
  key: string;
  /** Translated legend label. */
  label: string;
  className: string;
}

export interface TrendChartProps {
  /** Rows keyed by calendar date "YYYY-MM-DD". */
  data: ({ date: string } & Record<string, number | string>)[];
  series: TrendSeries[];
  /** Translated chart title (used for the accessible name). */
  title: string;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function TrendChart({ data, series, title }: TrendChartProps) {
  const { t, locale, fmt } = useI18n();
  const descId = useId();
  const W = 640;
  const H = 200;
  const padL = 34;
  const padB = 26;
  const padT = 8;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const groupW = data.length ? plotW / data.length : plotW;
  const barGap = 4;
  const barW = Math.max(4, Math.min(36, (groupW * 0.72 - barGap * (series.length - 1)) / series.length));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const summary = data
    .map((d) => `${formatWeekday(d.date, locale)} ${series.map((s) => `${s.label} ${d[s.key]}`).join(', ')}`)
    .join('; ');

  return (
    <figure className="trend">
      <div className="trend-legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.key} className="legend-item">
            <span className={`legend-swatch ${s.className}`} /> {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label={title} aria-describedby={descId} preserveAspectRatio="none">
        <desc id={descId}>{summary}</desc>
        {ticks.map((v) => {
          const y = padT + plotH - (v / max) * plotH;
          return (
            <g key={v}>
              <line x1={padL} x2={W - 8} y1={y} y2={y} className="trend-grid" />
              <text x={padL - 6} y={y + 4} className="trend-axis" textAnchor="end">
                {v}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const gx = padL + i * groupW + (groupW - (barW * series.length + barGap * (series.length - 1))) / 2;
          return (
            <g key={d.date}>
              {series.map((s, j) => {
                const v = Number(d[s.key]) || 0;
                const h = (v / max) * plotH;
                return <rect key={s.key} x={gx + j * (barW + barGap)} y={padT + plotH - h} width={barW} height={Math.max(h, v > 0 ? 1 : 0)} rx={4} className={s.className} />;
              })}
              <text x={padL + i * groupW + groupW / 2} y={H - 8} className="trend-axis" textAnchor="middle">
                {formatWeekday(d.date, locale)}
              </text>
            </g>
          );
        })}
      </svg>
      <details className="trend-table">
        <summary>{t('Show data table')}</summary>
        <table className="dt">
          <caption className="visually-hidden">{title}</caption>
          <thead>
            <tr>
              <th scope="col">{t('Date')}</th>
              {series.map((s) => (
                <th scope="col" key={s.key}>
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date}>
                <th scope="row">
                  {formatMonthDay(d.date, locale)} ({formatWeekday(d.date, locale)})
                </th>
                {series.map((s) => (
                  <td key={s.key}>{fmt.number(Number(d[s.key]) || 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
