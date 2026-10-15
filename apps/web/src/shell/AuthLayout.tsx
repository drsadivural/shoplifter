// Signed-out layout (web-01/02/03, invite): photo + message panel on the left, form card on the
// right, following the shoplifter.ayonix.com sign-in design. The photo is a decorative brand image.
import { useEffect, type ReactNode } from 'react';
import heroUrl from '../assets/login-hero.webp';
import { BarsIcon, PeopleIcon, ShieldCheckIcon } from '../components/auth-icons';
import { useI18n } from '../i18n';
import '../styles/auth.css';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  hideTitle = false,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** The sign-in card shows only the wordmark; the page title stays available to assistive tech. */
  hideTitle?: boolean;
}) {
  const { t, locale, setLocale } = useI18n();
  useEffect(() => {
    document.title = `${title} · shoplifter.ayonix.com`;
  }, [title]);
  const features = [
    { icon: <ShieldCheckIcon width={30} height={30} />, title: t('auth|Detect'), sub: t('auth|Suspicious Activity') },
    { icon: <BarsIcon width={30} height={30} />, title: t('auth|Prevent'), sub: t('auth|Losses') },
    { icon: <PeopleIcon width={30} height={30} />, title: t('auth|Create'), sub: t('auth|Safer Stores') },
  ];
  return (
    <div className="auth2">
      <a href="#main" className="skip-link">
        {t('Skip to content')}
      </a>
      <svg className="auth2-swoosh" viewBox="0 0 1440 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="auth2-swoosh-blue" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--auth2-swoosh-a)" />
            <stop offset="1" stopColor="var(--auth2-swoosh-b)" />
          </linearGradient>
        </defs>
        <path className="auth2-swoosh-soft" d="M0 520 C 380 470 560 760 900 860 C 1130 925 1300 900 1440 820 L1440 1000 L0 1000 Z" />
        <path fill="url(#auth2-swoosh-blue)" d="M960 1000 C 1150 975 1330 900 1440 770 L1440 1000 Z" />
      </svg>
      <button
        type="button"
        className="auth2-lang"
        onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}
        aria-label={t('Display language: {current}. Switch to {other}.', {
          current: locale === 'ja' ? '日本語' : 'English',
          other: locale === 'ja' ? 'English' : '日本語',
        })}
      >
        English / 日本語
      </button>

      <aside className="auth2-hero">
        <img className="auth2-photo" src={heroUrl} alt="" width={840} height={640} decoding="async" />
        <div className="auth2-copy">
          <p className="auth2-headline">
            <span>{t('auth|Safer Retail')}</span>
            <span className="auth2-accent">{t('auth|Starts Here.')}</span>
          </p>
          <p className="auth2-lead">{t('auth|AI-powered insights to detect, prevent and reduce shoplifting in real time.')}</p>
          <ul className="auth2-features">
            {features.map((f) => (
              <li key={f.title}>
                <span className="auth2-feature-icon">{f.icon}</span>
                <span>
                  <strong>{f.title}</strong>
                  <span>{f.sub}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="auth2-main" id="main" tabIndex={-1}>
        <div className="auth2-card">
          <div className="auth2-wordmark" aria-label="shoplifter.ayonix.com">
            <span className="auth2-wm-strong">shoplifter</span>
            <span className="auth2-wm-dot">.</span>
            <span className="auth2-wm-light">ayonix.com</span>
          </div>
          <p className="auth2-tagline">{t('auth|DETECT · PREVENT · PROTECT')}</p>
          <h1 id="page-title" tabIndex={-1} className={hideTitle ? 'visually-hidden' : 'auth2-title'}>
            {title}
          </h1>
          {subtitle ? <p className="auth2-subtitle">{subtitle}</p> : null}
          {children}
          {footer ? <div className="auth2-card-foot">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
