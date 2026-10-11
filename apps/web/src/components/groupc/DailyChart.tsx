// Daily detections vs human-reviewed outcomes (web-41). Each day: a light bar for all detections
// with the reviewed outcomes stacked inside it (confirmed / false alert / inconclusive).
// SVG with a <details> data-table fallback; colors come from tokens (group-c.css).
import { useId } from 'react';
import { useI18n } from '../../i18n';
import '../../styles/group-c.css';

export interface DailyRow {
  date: string;
  detections: number;
  confirmed: number;
  false_alert: number;
  inconclusive: number;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function DailyChart({ rows, title }: { rows: DailyRow[]; title: string }) {
  const { t, fmt } = useI18n();
  const descId = useId();
  const W = 680;
  const H = 220;
  const padL = 36;
  const padB = 28;
  const padT = 8;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;
  const max = niceMax(Math.max(0, ...rows.map((r) => Math.max(r.detections, r.confirmed + r.false_alert + r.inconclusive))));
  const slot = rows.length ? plotW / rows.length : plotW;
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const labelEvery = Math.max(1, Math.ceil(rows.length / 8));
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const series = [
    { key: 'confirmed', label: t('Confirmed incident'), cls: 'gc-s-confirmed' },
    { key: 'false_alert', label: t('False alert'), cls: 'gc-s-false' },
    { key: 'inconclusive', label: t('Inconclusive'), cls: 'gc-s-inconclusive' },
  ] as const;
  const summary = rows
    .map((r) => `${r.date}: ${t('Detections')} ${r.detections}, ${series.map((s) => `${s.label} ${r[s.key]}`).join(', ')}`)
    .join('; ');
  return (
    <figure className="trend gc-daily">
      <div className="trend-legend" aria-hidden="true">
        <span className="legend-item">
          <span className="legend-swatch gc-swatch-detections" /> {t('Detections')}
        </span>
        {series.map((s) => (
          <span key={s.key} className="legend-item">
            <span className={`legend-swatch ${s.cls}`} /> {s.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label={title} aria-describedby={descId} preserveAspectRatio="none">
        <desc id={descId}>{summary}</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = Math.round(max * f);
          return (
            <g key={f}>
              <line x1={padL} x2={W - 8} y1={y(v)} y2={y(v)} className="trend-grid" />
              <text x={padL - 6} y={y(v) + 4} className="trend-axis" textAnchor="end">
                {v}
              </text>
            </g>
          );
        })}
        {rows.map((r, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          let acc = 0;
          return (
            <g key={r.date}>
              <rect x={x} y={y(r.detections)} width={barW} height={plotH + padT - y(r.detections)} rx={3} className="gc-s-detections" />
              {series.map((s) => {
                const v = r[s.key];
                const top = y(acc + v);
                const h = y(acc) - top;
                acc += v;
                return v > 0 ? <rect key={s.key} x={x + barW * 0.2} y={top} width={barW * 0.6} height={h} className={s.cls} /> : null;
              })}
              {i % labelEvery === 0 || i === rows.length - 1 ? (
                <text x={x + barW / 2} y={H - 9} className="trend-axis" textAnchor="middle">
                  {r.date.slice(5).replace('-', '/')}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <details className="trend-table">
        <summary>{t('Show data table')}</summary>
        <div className="dt-scroll">
          <table className="dt">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Date')}</th>
                <th scope="col">{t('Detections')}</th>
                {series.map((s) => (
                  <th scope="col" key={s.key}>
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date}>
                  <th scope="row">{r.date}</th>
                  <td>{fmt.number(r.detections)}</td>
                  {series.map((s) => (
                    <td key={s.key}>{fmt.number(r[s.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
