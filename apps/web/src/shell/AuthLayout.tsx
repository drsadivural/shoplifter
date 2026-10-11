// Signed-out layout (web-01/02/03, invite): brand panel on the left, form card on the right.
// The brand panel is decorative and contains no camera imagery or demonstration records.
import { useEffect, type ReactNode } from 'react';
import { useI18n } from '../i18n';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { t, locale, setLocale } = useI18n();
  useEffect(() => {
    document.title = `${title} · RetailGuard`;
  }, [title]);
  return (
    <div className="auth">
      <a href="#main" className="skip-link">
        {t('Skip to content')}
      </a>
      <div className="auth-art" aria-hidden="true">
        <div className="brand brand-inverse">
          <span className="mark">◈</span> Ayonix RetailGuard
        </div>
        <div>
          <p className="auth-headline">{t('Safer stores. Informed decisions.')}</p>
          <p className="auth-lead">{t('Video evidence, enrolled profiles and staff response in one workspace.')}</p>
          <ul className="auth-points">
            <li>{t('AI signals are candidate evidence. People make the decisions.')}</li>
            <li>{t('Every action is recorded in the audit log.')}</li>
            <li>{t('Access follows your role and assigned stores.')}</li>
          </ul>
        </div>
        <div className="auth-foot">© Ayonix</div>
      </div>
      <main className="auth-form" id="main" tabIndex={-1}>
        <div className="card auth-card">
          <div className="brand auth-card-brand">
            <span className="mark" aria-hidden="true">
              ◈
            </span>{' '}
            RetailGuard
          </div>
          <h1 id="page-title" tabIndex={-1}>
            {title}
          </h1>
          {subtitle ? <p className="muted">{subtitle}</p> : null}
          {children}
          <div className="auth-card-foot">
            <span>{footer}</span>
            <button
              type="button"
              className="link-btn"
              onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}
              aria-label={t('Display language: {current}. Switch to {other}.', {
                current: locale === 'ja' ? '日本語' : 'English',
                other: locale === 'ja' ? 'English' : '日本語',
              })}
            >
              English / 日本語
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
