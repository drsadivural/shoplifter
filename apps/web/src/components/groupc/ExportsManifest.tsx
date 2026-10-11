// Evidence manifest: exports with status, purpose, recipient, expiry, per-file SHA-256 and the
// bundle hash. Downloads are authorized and audited by the API (export.create).
import { endpoints } from '../../api/endpoints';
import type { ExportRecord } from '../../pages/_groupc-api';
import { useI18n } from '../../i18n';
import { formatBytes } from '../../lib/format';
import { useSession } from '../../session/SessionProvider';
import { StatusPill } from '../primitives';
import { EXPORT_STATUS, REDACTION_KEY, shortHash } from './labels';
import '../../styles/group-c.css';

export function ExportsManifest({ exports, timeZone }: { exports: ExportRecord[]; timeZone: string }) {
  const { t, fmt, locale } = useI18n();
  const { can } = useSession();
  if (exports.length === 0) return <p className="muted small">{t('No evidence exports have been generated for this case.')}</p>;
  return (
    <ul className="gc-list">
      {exports.map((e) => {
        const [tone, key] = EXPORT_STATUS[e.status] ?? EXPORT_STATUS.failed!;
        return (
          <li key={e.id}>
            <div className="gc-list-main">
              <span className="gc-inline">
                <StatusPill tone={tone}>{t(key)}</StatusPill>
                <span className="small">{fmt.dateTime(e.created_at, timeZone, { withZone: true, seconds: false })}</span>
              </span>
              <span className="small gc-wrap">
                {t('Recipient')}: {e.recipient} · {t('Redaction')}: {t(REDACTION_KEY[e.redaction])}
              </span>
              <span className="muted small gc-wrap">
                {t('Export reason')}: {e.reason}
              </span>
              <span className="muted small">
                {t('Expires {date}', { date: fmt.dateTime(e.expires_at, timeZone, { withZone: true, seconds: false }) })} ·{' '}
                {t('Downloaded {n} times', { n: e.download_count })}
              </span>
              {e.manifest ? (
                <details>
                  <summary className="small">
                    {t('{n} files', { n: e.manifest.files.length })}
                    {e.manifest.bundle_sha256 ? (
                      <span className="mono" title={e.manifest.bundle_sha256}>
                        {' '}
                        · {t('Bundle')} SHA-256 {shortHash(e.manifest.bundle_sha256)}
                      </span>
                    ) : null}
                  </summary>
                  <div className="dt-scroll">
                    <table className="dt gc-table-compact">
                      <caption className="visually-hidden">{t('Evidence manifest')}</caption>
                      <thead>
                        <tr>
                          <th scope="col">{t('File')}</th>
                          <th scope="col">{t('Size')}</th>
                          <th scope="col">SHA-256</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.manifest.files.map((f) => (
                          <tr key={f.name}>
                            <td className="gc-wrap small">{f.name}</td>
                            <td className="small">{formatBytes(f.size, locale)}</td>
                            <td className="mono small gc-wrap">{f.sha256}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : e.status === 'queued' ? (
                <span className="muted small">{t('The manifest is created when the bundle is ready.')}</span>
              ) : null}
              {e.status === 'failed' && e.error ? <span className="field-error small">{e.error}</span> : null}
            </div>
            {e.status === 'ready' && can('export.create') ? (
              <a className="btn btn-secondary btn-sm" href={endpoints.exports.downloadUrl(e.id)} download>
                {t('Download')}
              </a>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
