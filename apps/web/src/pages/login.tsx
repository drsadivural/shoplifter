// web-01 Sign in. POST /v1/auth/login; "Sign in with Google" uses the OIDC flow
// (GET /v1/auth/config -> /v1/auth/oidc/start) when Google is configured as the identity provider.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useMutation } from '../api/hooks';
import { ArrowRightIcon, GoogleGIcon, LockIcon, MailIcon } from '../components/auth-icons';
import { FormField } from '../components/forms';
import { UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { safeNext } from '../lib/nav';
import { getScreen } from '../routes.meta';
import { AuthLayout } from '../shell/AuthLayout';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export default function LoginPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [ssoNotice, setSsoNotice] = useState<{ support: string | null } | null>(null);

  const login = useMutation(endpoints.auth.login, {
    toastErrors: false,
    onError: (e) => {
      if (e.code === 'invalid_credentials' || e.status === 401) setFormError(t('The email address or password is incorrect.'));
      else if (e.status === 429) setFormError(t('Too many sign-in attempts. Wait a few minutes and try again.'));
      else if (e.isNetwork) setFormError(t('The server could not be reached. Check the connection and try again.'));
      else setFormError(`${t('Sign-in failed.')} ${e.message}${e.requestId ? ` (${t('Request ID')}: ${e.requestId})` : ''}`);
      return true;
    },
  });

  const sso = useMutation(() => endpoints.auth.config(), {
    toastErrors: false,
    onError: (e) => {
      setFormError(`${t('Sign-in options could not be loaded.')} ${e.requestId ? `(${t('Request ID')}: ${e.requestId})` : ''}`);
      return true;
    },
  });

  const emailError = touched && !EMAIL_RE.test(email.trim()) ? t('Enter your work email address.') : null;
  const passwordError = touched && password.length === 0 ? t('Enter your password.') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setFormError(null);
    if (!EMAIL_RE.test(email.trim()) || !password) return;
    const r = await login.run({ email: email.trim(), password });
    if (!r.ok) return;
    setPassword('');
    if (r.data.state === 'authenticated') navigate(next, { replace: true });
    else if (r.data.state === 'mfa_required') navigate(`/web/mfa?next=${encodeURIComponent(next)}`, { replace: true });
    else navigate(`/web/mfa?enroll=1&next=${encodeURIComponent(next)}`, { replace: true });
  };

  const startGoogle = async () => {
    setFormError(null);
    setSsoNotice(null);
    const r = await sso.run(undefined);
    if (!r.ok) return;
    if (r.data.oidc_enabled) window.location.assign(endpoints.auth.oidcStartUrl);
    else setSsoNotice({ support: r.data.support_contact });
  };

  const expired = params.get('reason') === 'expired';

  return (
    <AuthLayout title={getScreen('web-01').title[locale]} hideTitle>
      {expired ? (
        <div className="notice notice-info" role="status">
          {t('Your session ended. Sign in again to continue.')}
        </div>
      ) : null}
      <form onSubmit={submit} noValidate className="auth2-form">
        <FormField label={t('auth|Email Address')} error={emailError}>
          {(p) => (
            <div className="auth2-input">
              <MailIcon />
              <input
                {...p}
                type="email"
                autoComplete="username"
                inputMode="email"
                placeholder={t('auth|Enter your email')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}
        </FormField>
        <div className="auth2-pw">
          <FormField label={t('Password')} error={passwordError}>
            {(p) => (
              <div className="auth2-input">
                <LockIcon />
                <input
                  {...p}
                  type="password"
                  autoComplete="current-password"
                  placeholder={t('auth|Enter your password')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}
          </FormField>
          <Link to="/web/reset" className="auth2-forgot">
            {t('auth|Forgot password?')}
          </Link>
        </div>
        {formError ? (
          <div className="form-error" role="alert">
            {formError}
          </div>
        ) : null}
        <button type="submit" className="auth2-primary" disabled={login.pending} aria-busy={login.pending || undefined}>
          {login.pending ? <span className="auth2-spinner" aria-hidden="true" /> : null}
          {t('auth|Sign In')}
          {login.pending ? null : <ArrowRightIcon />}
        </button>
      </form>
      <div className="auth2-or" role="separator">
        {t('auth|OR')}
      </div>
      <button type="button" className="auth2-google" onClick={startGoogle} disabled={sso.pending} aria-busy={sso.pending || undefined}>
        <GoogleGIcon />
        {t('auth|Sign in with Google')}
      </button>
      {ssoNotice ? (
        <UnavailableNotice code="oidc_unconfigured">
          {t('auth|Google sign-in has not been set up for this workspace yet. Sign in with your email address and password, or ask your administrator.')}
          {ssoNotice.support ? (
            <>
              {' '}
              {t('Support contact')}: {ssoNotice.support}
            </>
          ) : null}
        </UnavailableNotice>
      ) : null}
    </AuthLayout>
  );
}
