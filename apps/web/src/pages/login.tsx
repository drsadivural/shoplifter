// web-01 Sign in. POST /v1/auth/login; SSO via GET /v1/auth/config -> /v1/auth/oidc/start.
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useMutation } from '../api/hooks';
import { Button } from '../components/primitives';
import { Checkbox, TextField } from '../components/forms';
import { UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { safeNext } from '../lib/nav';
import { getScreen } from '../routes.meta';
import { AuthLayout } from '../shell/AuthLayout';

const REMEMBER_KEY = 'rg.rememberedEmail';

function readRemembered(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function LoginPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState(readRemembered);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => readRemembered() !== '');
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

  const emailError = touched && !/^\S+@\S+\.\S+$/.test(email.trim()) ? t('Enter your work email address.') : null;
  const passwordError = touched && password.length === 0 ? t('Enter your password.') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setFormError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password) return;
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, email.trim());
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* storage unavailable */
    }
    const r = await login.run({ email: email.trim(), password });
    if (!r.ok) return;
    setPassword('');
    if (r.data.state === 'authenticated') navigate(next, { replace: true });
    else if (r.data.state === 'mfa_required') navigate(`/web/mfa?next=${encodeURIComponent(next)}`, { replace: true });
    else navigate(`/web/mfa?enroll=1&next=${encodeURIComponent(next)}`, { replace: true });
  };

  const startSso = async () => {
    setFormError(null);
    setSsoNotice(null);
    const r = await sso.run(undefined);
    if (!r.ok) return;
    if (r.data.oidc_enabled) window.location.assign(endpoints.auth.oidcStartUrl);
    else setSsoNotice({ support: r.data.support_contact });
  };

  const expired = params.get('reason') === 'expired';

  return (
    <AuthLayout
      title={getScreen('web-01').title[locale]}
      subtitle={t('Secure access to your assigned stores')}
      footer={<Link to="/web/reset">{t('Forgot your password?')}</Link>}
    >
      {expired ? (
        <div className="notice notice-info" role="status">
          {t('Your session ended. Sign in again to continue.')}
        </div>
      ) : null}
      <form onSubmit={submit} noValidate className="auth-fields">
        <div className="form-grid">
          <TextField
            label={t('Work email')}
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError}
          />
          <TextField
            label={t('Password')}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={passwordError}
          />
        </div>
        <Checkbox
          label={t('Remember this device')}
          hint={t('Remembers your work email on this browser only. Your password is never stored.')}
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        {formError ? (
          <div className="form-error" role="alert">
            {formError}
          </div>
        ) : null}
        <div className="auth-actions">
          <Button type="submit" pending={login.pending}>
            {t('Sign in')}
          </Button>
          <Button variant="secondary" onClick={startSso} pending={sso.pending}>
            {t('Continue with company SSO')}
          </Button>
        </div>
      </form>
      {ssoNotice ? (
        <UnavailableNotice code="oidc_unconfigured">
          {t('Single sign-on has not been set up for this workspace. Sign in with your work email and password, or ask your administrator.')}
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
