// /web/invite?token=... — accept an invitation (not in the screen catalog; needed by web-44).
// POST /v1/auth/invitations/accept {token, display_name, password}
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useMutation } from '../api/hooks';
import { TextField } from '../components/forms';
import { Button, Notice } from '../components/primitives';
import { useI18n } from '../i18n';
import { MIN_PASSWORD_LENGTH, passwordProblem } from '../lib/password';
import { AuthLayout } from '../shell/AuthLayout';

export default function InvitePage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = useMutation(endpoints.auth.acceptInvitation, {
    toastErrors: false,
    onError: (e) => {
      if (e.code === 'invalid_or_expired_token' || e.status === 404 || e.status === 410)
        setError(t('This invitation is invalid, already used, or expired. Ask your administrator for a new one.'));
      else if (e.code === 'weak_password' || e.fieldErrors.password)
        setError(t('Choose a stronger password: longer, and not a common or previously breached password.'));
      else setError(`${t('The invitation could not be accepted.')} ${e.requestId ? `(${t('Request ID')}: ${e.requestId})` : ''}`);
      return true;
    },
  });

  const title = t('Accept invitation');
  if (!token) {
    return (
      <AuthLayout title={title} footer={<Link to="/web/login">{t('Back to sign in')}</Link>}>
        <Notice tone="warning">{t('This invitation link is incomplete. Open the full link from your invitation, or ask your administrator for a new one.')}</Notice>
      </AuthLayout>
    );
  }

  const nameErr = touched && name.trim().length < 1 ? t('Enter the name your teammates will see.') : null;
  const pwErr = touched && pw.length < MIN_PASSWORD_LENGTH ? t('Use at least {n} characters.', { n: MIN_PASSWORD_LENGTH }) : null;
  const confirmErr = touched && !pwErr && confirm !== pw ? t('The passwords do not match.') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!name.trim() || passwordProblem(pw, confirm)) return;
    const r = await accept.run({ token, display_name: name.trim(), password: pw });
    if (r.ok) {
      setPw('');
      setConfirm('');
      setDone(true);
    }
  };

  return (
    <AuthLayout title={title} subtitle={t('Set up your RetailGuard account.')} footer={<Link to="/web/login">{t('Back to sign in')}</Link>}>
      {done ? (
        <div role="status" className="auth-fields">
          <Notice tone="info" title={t('Account ready')}>
            {t('Your account has been created. Sign in to continue. Your role may require two-step verification.')}
          </Notice>
          <Link className="btn btn-primary btn-md" to="/web/login">
            {t('Sign in')}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="auth-fields">
          <TextField label={t('Display name')} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} error={nameErr} />
          <TextField
            label={t('Password')}
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
              {error}
            </div>
          ) : null}
          <div className="auth-actions">
            <Button type="submit" pending={accept.pending}>
              {t('Create account')}
            </Button>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
