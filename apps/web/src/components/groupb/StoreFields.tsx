// Store form fields shared by web-07 (add a store) and the edit dialog on web-06 (store detail).
import { useI18n } from '../../i18n';
import { SelectField, TextField } from '../forms';
import { TIMEZONES } from './api';

export interface StoreDraft {
  name: string;
  region: string;
  address: string;
  timezone: string;
  manager_name: string;
  opening_hours: string;
}

export const EMPTY_STORE: StoreDraft = { name: '', region: '', address: '', timezone: 'Asia/Tokyo', manager_name: '', opening_hours: '' };

export type StoreErrors = Partial<Record<keyof StoreDraft, string | null>>;

/** Client-side checks mirroring services/api StoreIn (required name/address/timezone, max lengths). */
export function validateStore(d: StoreDraft, t: (k: string) => string): StoreErrors {
  const e: StoreErrors = {};
  if (!d.name.trim()) e.name = t('field_error|required');
  if (!d.address.trim()) e.address = t('field_error|required');
  if (!d.timezone) e.timezone = t('field_error|required');
  return e;
}

export function trimStore(d: StoreDraft): StoreDraft {
  return {
    name: d.name.trim(),
    region: d.region.trim(),
    address: d.address.trim(),
    timezone: d.timezone,
    manager_name: d.manager_name.trim(),
    opening_hours: d.opening_hours.trim(),
  };
}

export function StoreFields({
  draft,
  onChange,
  errors,
}: {
  draft: StoreDraft;
  onChange: (k: keyof StoreDraft, v: string) => void;
  errors: StoreErrors;
}) {
  const { t } = useI18n();
  const tz = Array.from(new Set([draft.timezone, ...TIMEZONES].filter(Boolean))).map((z) => ({ value: z, label: z }));
  return (
    <div className="form-grid">
      <TextField
        label={t('Store name')}
        required
        maxLength={200}
        value={draft.name}
        onChange={(e) => onChange('name', e.target.value)}
        error={errors.name}
      />
      <TextField
        label={t('Region')}
        maxLength={100}
        value={draft.region}
        onChange={(e) => onChange('region', e.target.value)}
        error={errors.region}
        hint={t('Used to group stores, for example Kanto or Kansai.')}
      />
      <TextField
        label={t('Address')}
        required
        maxLength={500}
        value={draft.address}
        onChange={(e) => onChange('address', e.target.value)}
        error={errors.address}
        autoComplete="street-address"
      />
      <SelectField
        label={t('Timezone')}
        required
        value={draft.timezone}
        onChange={(e) => onChange('timezone', e.target.value)}
        options={tz}
        error={errors.timezone}
        hint={t('All alerts and records for this store are shown in this timezone.')}
      />
      <TextField
        label={t('Store manager')}
        maxLength={120}
        value={draft.manager_name}
        onChange={(e) => onChange('manager_name', e.target.value)}
        error={errors.manager_name}
      />
      <TextField
        label={t('Opening hours')}
        maxLength={200}
        value={draft.opening_hours}
        onChange={(e) => onChange('opening_hours', e.target.value)}
        error={errors.opening_hours}
        placeholder={t('e.g. 10:00–21:00')}
      />
    </div>
  );
}
