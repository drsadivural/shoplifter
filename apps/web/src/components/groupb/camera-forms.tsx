// Camera onboarding form pieces shared by web-11 (discovery add), web-12 (manual add) and web-13 (CSV import).
// Passwords are write-only: the field is type=password, never pre-filled, cleared after every submit,
// and the API never returns them (credentials are sealed to the store edge's public key).
import { Link } from 'react-router';
import type { Camera } from '../../api/types';
import { useI18n } from '../../i18n';
import { screenPath } from '../../routes.meta';
import { useSession } from '../../session/SessionProvider';
import { SelectField, TextField } from '../forms';
import { Notice } from '../primitives';

export function CredentialFields({
  username,
  password,
  onUsername,
  onPassword,
  profile,
  onProfile,
  errors,
  showProfile = true,
}: {
  username: string;
  password: string;
  onUsername: (v: string) => void;
  onPassword: (v: string) => void;
  profile?: Camera['stream_profile'];
  onProfile?: (v: Camera['stream_profile']) => void;
  errors: Record<string, string | null | undefined>;
  showProfile?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      <TextField
        label={t('Username')}
        maxLength={120}
        autoComplete="off"
        value={username}
        onChange={(e) => onUsername(e.target.value)}
        error={errors.username}
        hint={t('Use a read-only camera account.')}
      />
      <TextField
        label={t('Password')}
        type="password"
        maxLength={256}
        autoComplete="new-password"
        value={password}
        onChange={(e) => onPassword(e.target.value)}
        error={errors.password}
        hint={t('Encrypted to the store edge appliance. It is never shown again or stored readable in the cloud.')}
      />
      {showProfile && onProfile ? (
        <SelectField
          label={t('Stream profile')}
          value={profile}
          onChange={(e) => onProfile(e.target.value as Camera['stream_profile'])}
          options={[
            { value: 'substream', label: t('Substream (recommended for analysis)') },
            { value: 'mainstream', label: t('Main stream (higher resolution, more load)') },
          ]}
          error={errors.stream_profile}
        />
      ) : null}
    </>
  );
}

/** 409 edge_required: credentials can only be stored once an edge appliance is paired. */
export function EdgeRequiredNotice({ storeId }: { storeId?: string }) {
  const { t } = useI18n();
  const { can } = useSession();
  return (
    <Notice tone="warning" title={t('Pair an edge appliance before storing camera credentials')}>
      {t('Camera passwords are encrypted to the store’s edge appliance and are never stored readable in the cloud, so they can only be saved after an appliance is paired. Add the camera without credentials now, or pair the appliance first.')}{' '}
      {can('edge.manage') ? <Link to={screenPath('web-08', { store_id: storeId })}>{t('Connect edge appliance')}</Link> : null}
    </Notice>
  );
}

/** "onvif://www.onvif.org/Profile/T" -> "Profile T"; the Streaming scope means Profile S. */
export function onvifProfiles(scopes: string[]): string[] {
  const out = new Set<string>();
  for (const s of scopes) {
    const m = /onvif:\/\/www\.onvif\.org\/Profile\/([A-Za-z]+)/i.exec(s);
    if (!m?.[1]) continue;
    out.add(m[1].toLowerCase() === 'streaming' ? 'Profile S' : `Profile ${m[1].toUpperCase()}`);
  }
  return [...out].sort();
}
