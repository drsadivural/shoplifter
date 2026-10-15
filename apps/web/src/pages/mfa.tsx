// web-02 Verify your identity.
//   verify mode:   POST /v1/auth/mfa/verify {code | recovery_code, trust_device}
//   enroll mode:   ?enroll=1 -> GET /v1/auth/mfa/setup (QR + secret) -> POST /v1/auth/mfa/enable
//                  -> recovery codes shown exactly once.
//   &optional=1:   opened from Settings by someone whose role does not require it; Cancel returns to `next`.
import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation } from '../api/hooks';
import { Checkbox, TextField } from '../components/forms';
import { Button, Notice } from '../components/primitives';
import { QueryErrorView } from '../components/RouteStateBoundary';
import { LoadingState } from '../components/states';
import { useI18n } from '../i18n';
import { safeNext } from '../lib/nav';
import { getScreen } from '../routes.meta';
import { AuthLayout } from '../shell/AuthLayout';

function useMfaErrorText() {
  const { t } = useI18n();
  return (e: ApiError): string => {
    if (e.code === 'invalid_code') return t('That code is not valid. Check the time on your device and try again.');
    if (e.status === 429) return t('Too many attempts. Wait a few minutes and try again.');
    if (e.code === 'session_expired' || e.code === 'authentication_required') return t('Your sign-in has expired. Sign in again.');
    return `${t('Verification failed.')} ${e.message}${e.requestId ? ` (${t('Request ID')}: ${e.requestId})` : ''}`;
  };
}

export default function MfaPage() {
  const { t, locale } = useI18n();
  const [params] = useSearchParams();
  const enroll = params.get('enroll') === '1';
  const optional = enroll && params.get('optional') === '1';
  const next = safeNext(params.get('next'));
  return (
    <AuthLayout
      title={getScreen('web-02').title[locale]}
      footer={optional ? <Link to={next}>{t('Cancel and go back')}</Link> : <Link to="/web/login">{t('Back to sign in')}</Link>}
    >
      {enroll ? <EnrollMfa next={next} optional={optional} /> : <VerifyMfa next={next} />}
    </AuthLayout>
  );
}

function VerifyMfa({ next }: { next: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const errorText = useMfaErrorText();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [trust, setTrust] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const verify = useMutation(endpoints.auth.mfaVerify, {
    toastErrors: false,
    onError: (e) => {
      setError(errorText(e));
      setExpired(e.code === 'session_expired' || e.code === 'authentication_required');
      return true;
    },
  });

  const valid = useRecovery ? code.trim().length >= 6 : /^\d{6}$/.test(code.replace(/\s/g, ''));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!valid) {
      setError(useRecovery ? t('Enter one of your recovery codes.') : t('Enter the 6-digit code from your authenticator app.'));
      return;
    }
    const body = useRecovery
      ? { recovery_code: code.trim(), trust_device: trust }
      : { code: code.replace(/\s/g, ''), trust_device: trust };
    const r = await verify.run(body);
    if (r.ok) navigate(next, { replace: true });
  };

  return (
    <form onSubmit={submit} noValidate className="auth-fields">
      <p className="muted">
        {useRecovery
          ? t('Enter one of the recovery codes you saved when you set up two-step verification. Each code works once.')
          : t('Enter the 6-digit code from your authenticator app.')}
      </p>
      {useRecovery ? (
        <TextField
          key="recovery"
          label={t('Recovery code')}
          autoComplete="off"
          spellCheck={false}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      ) : (
        <TextField
          key="totp"
          label={t('Authentication code')}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      )}
      <Checkbox
        label={t('Trusted device')}
        hint={t('Skip this step on this browser for a limited time. Do not use on shared computers.')}
        checked={trust}
        onChange={(e) => setTrust(e.target.checked)}
      />
      {error ? (
        <div className="form-error" role="alert">
          {error} {expired ? <Link to="/web/login">{t('Sign in again')}</Link> : null}
        </div>
      ) : null}
      <div className="auth-actions">
        <Button type="submit" pending={verify.pending}>
          {t('Verify')}
        </Button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode('');
            setError(null);
          }}
        >
          {useRecovery ? t('Use an authentication code instead') : t('Use a recovery code instead')}
        </button>
      </div>
    </form>
  );
}

function EnrollMfa({ next, optional }: { next: string; optional: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const errorText = useMfaErrorText();
  const setup = useApiQuery((signal) => endpoints.auth.mfaSetup({ signal }), []);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nudge, setNudge] = useState(false);

  useEffect(() => {
    const uri = setup.data?.otpauth_uri;
    if (!uri) return;
    let cancelled = false;
    QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => !cancelled && setQrSvg(svg))
      .catch(() => !cancelled && setQrSvg(null));
    return () => {
      cancelled = true;
    };
  }, [setup.data?.otpauth_uri]);

  const enable = useMutation(endpoints.auth.mfaEnable, {
    toastErrors: false,
    onError: (e) => {
      setError(errorText(e));
      return true;
    },
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const c = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(c)) {
      setError(t('Enter the 6-digit code from your authenticator app.'));
      return;
    }
    const r = await enable.run({ code: c });
    if (r.ok) setRecoveryCodes(r.data.recovery_codes);
  };

  if (recoveryCodes) {
    const text = recoveryCodes.join('\n');
    return (
      <div className="auth-fields">
        <Notice tone="warning" title={t('Save your recovery codes now')}>
          {t('These codes are shown only once. Each code can be used once if you lose access to your authenticator app. Store them somewhere safe and private.')}
        </Notice>
        <ol className="recovery-codes mono" aria-label={t('Recovery codes')}>
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
        <div className="auth-actions">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? t('Copied') : t('Copy codes')}
          </Button>
        </div>
        <Checkbox label={t('I have saved these recovery codes')} checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <div className="auth-actions">
          <Button
            onClick={() => {
              if (saved) navigate(next, { replace: true });
              else setNudge(true);
            }}
          >
            {t('Continue')}
          </Button>
          {nudge && !saved ? (
            <span className="field-error" role="alert">
              {t('Confirm that you saved the codes to continue.')}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  if (setup.error) return <QueryErrorView error={setup.error} onRetry={setup.reload} />;
  if (!setup.data) return <LoadingState variant="inline" />;

  return (
    <form onSubmit={submit} noValidate className="auth-fields">
      <p className="muted">
        {optional
          ? t('Scan this QR code with your authenticator app, then enter the 6-digit code it shows.')
          : t('Two-step verification is required for your role. Scan this QR code with your authenticator app, then enter the 6-digit code it shows.')}
      </p>
      <div className="mfa-setup">
        {qrSvg ? (
          <div className="qr" role="img" aria-label={t('QR code for your authenticator app')} dangerouslySetInnerHTML={{ __html: qrSvg }} />
        ) : (
          <div className="qr qr-missing">{t('QR code could not be drawn. Enter the key manually.')}</div>
        )}
        <div>
          <div className="muted small">{t('Setup key (if you cannot scan)')}</div>
          <code className="secret mono" aria-label={t('Setup key')}>
            {setup.data.secret.replace(/(.{4})/g, '$1 ').trim()}
          </code>
        </div>
      </div>
      <TextField
        label={t('Authentication code')}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        required
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="auth-actions">
        <Button type="submit" pending={enable.pending}>
          {t('Verify')}
        </Button>
      </div>
    </form>
  );
}
