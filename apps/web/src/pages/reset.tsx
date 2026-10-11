// web-03 Reset password.
//   request mode:  POST /v1/auth/password-reset/request {email} -> always the same confirmation
//                  (never reveals whether an account exists)
//   complete mode: ?token=... -> POST /v1/auth/password-reset/complete {token, new_password}
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useMutation } from '../api/hooks';
import { TextField } from '../components/forms';
import { Button, Notice } from '../components/primitives';
import { useI18n } from '../i18n';
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../lib/password';
import { getScreen } from '../routes.meta';
import { AuthLayout } from '../shell/AuthLayout';

export default function ResetPage() {
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token');
  return (
    <AuthLayout title={getScreen('web-03').title[locale]} footer={<Link to="/web/login">{t('Back to sign in')}</Link>}>
      {token ? <CompleteReset token={token} /> : <RequestReset />}
    </AuthLayout>
  );
}

function RequestReset() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useMutation(endpoints.auth.passwordResetRequest, {
    toastErrors: false,
    onError: (e) => {
      setError(
        e.status === 429
          ? t('Too many attempts. Wait a moment and try again.')
          : `${t('The request could not be sent.')} ${e.requestId ? `(${t('Request ID')}: ${e.requestId})` : ''}`,
      );
      return true;
    },
  });
  const invalid = !/^\S+@\S+\.\S+$/.test(email.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (invalid) return;
    const r = await request.run({ email: email.trim() });
    if (r.ok) setSent(true);
  };

  if (sent) {
    return (
      <div role="status" className="auth-fields">
        <Notice tone="info" title={t('Check your email')}>
          {t('If an account exists for that address, a password reset link has been sent. The link expires after a short time.')}
        </Notice>
        <Button variant="secondary" onClick={() => setSent(false)}>
          {t('Send another link')}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="auth-fields">
      <p className="muted">{t('Enter your work email. If it belongs to an account, we will send a reset link.')}</p>
      <TextField
        label={t('Work email')}
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={touched && invalid ? t('Enter your work email address.') : null}
      />
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="auth-actions">
        <Button type="submit" pending={request.pending}>
          {t('Send reset link')}
        </Button>
      </div>
    </form>
  );
}

function CompleteReset({ token }: { token: string }) {
  const { t } = useI18n();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<{ text: string; expired: boolean } | null>(null);
  const complete = useMutation(endpoints.auth.passwordResetComplete, {
    toastErrors: false,
    onError: (e) => {
      if (e.code === 'invalid_or_expired_token') setError({ text: t('This reset link is invalid or has expired.'), expired: true });
      else if (e.code === 'weak_password' || e.fieldErrors.new_password)
        setError({ text: t('Choose a stronger password: longer, and not a common or previously breached password.'), expired: false });
      else setError({ text: `${t('The password could not be changed.')} ${e.requestId ? `(${t('Request ID')}: ${e.requestId})` : ''}`, expired: false });
      return true;
    },
  });
  const problem = passwordProblem(pw, confirm);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (problem) return;
    const r = await complete.run({ token, new_password: pw });
    if (r.ok) {
      setPw('');
      setConfirm('');
      setDone(true);
    }
  };

  if (done) {
    return (
      <div role="status" className="auth-fields">
        <Notice tone="info" title={t('Password changed')}>
          {t('Your password has been changed. Other sessions have been signed out.')}
        </Notice>
        <Link className="btn btn-primary btn-md" to="/web/login">
          {t('Sign in')}
        </Link>
      </div>
    );
  }
  const pwErr = touched && pw.length < MIN_PASSWORD_LENGTH ? t('Use at least {n} characters.', { n: MIN_PASSWORD_LENGTH }) : null;
  const confirmErr = touched && !pwErr && confirm !== pw ? t('The passwords do not match.') : null;
  return (
    <form onSubmit={submit} noValidate className="auth-fields">
      <TextField
        label={t('New password')}
        type="password"
        autoComplete="new-password"
        required
        hint={t('At least {n} characters. Avoid passwords you use elsewhere.', { n: MIN_PASSWORD_LENGTH })}
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        error={pwErr}
      />
      <TextField
        label={t('Confirm password')}
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={confirmErr}
      />
      {error ? (
        <div className="form-error" role="alert">
          {error.text} {error.expired ? <Link to="/web/reset">{t('Request a new link')}</Link> : null}
        </div>
      ) : null}
      <div className="auth-actions">
        <Button type="submit" pending={complete.pending}>
          {t('Change password')}
        </Button>
      </div>
    </form>
  );
}
