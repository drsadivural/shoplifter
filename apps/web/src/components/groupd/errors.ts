// Localized messages for group D API error codes and 422 field error codes.
import type { ApiError } from '../../api/client';
import { errorMessageKey } from '../../api/hooks';
import type { Locale } from '../../api/types';
import { translate } from '../../i18n';
import { fieldErrorText } from '../forms';

/** Command error codes returned by profiles/users/privacy routes (services/api). */
export const CODE_MESSAGE: Record<string, string> = {
  separation_of_duties: 'A different reviewer must approve this enrollment. The person who created it cannot approve it.',
  approved_photo_required: 'Approve at least one photo after checking its quality.',
  source_incident_not_confirmed: 'Watchlist enrollment requires a source incident that a person reviewed as a confirmed incident.',
  profile_expired: 'This profile has expired. Extend the expiry before approval.',
  photo_required: 'Add at least one reference photo before submitting for review.',
  photo_quality_insufficient: 'This photo failed the measured image checks. Upload a clearer photo instead.',
  duplicate_photo: 'This photo is already attached. Duplicates are not new evidence.',
  invalid_transition: 'This action is not allowed in the profile’s current state. Reload to see the current state.',
  profile_deleted: 'This profile was deleted.',
  self_lockout: 'You cannot change your own role, deactivate yourself or reset your own authenticator. Ask another administrator.',
  last_admin: 'At least one active organization admin is required. Promote another person first.',
  account_exists: 'This person already has an account.',
  no_legal_hold: 'This incident no longer has a legal hold.',
  photo_too_large: 'The photo is too large. Use a JPEG or PNG of 8 MB or less.',
};

export function apiErrorText(err: ApiError, locale: Locale): string {
  const key = CODE_MESSAGE[err.code];
  return translate(locale, key ?? errorMessageKey(err));
}

/** True for 409 responses that are real version conflicts (not domain rules such as last_admin). */
export function isVersionConflict(err: ApiError): boolean {
  return err.status === 409 && !(err.code in CODE_MESSAGE);
}

const FIELD_MESSAGE: Record<string, string> = {
  duplicate: 'This reference ID is already in use.',
  must_be_future: 'Choose a future date.',
  must_be_before_expiry: 'The review date must be after today and on or before the expiry date.',
  evidence_basis_required: 'Describe the evidence basis in at least 10 characters.',
  photo_notice_required: 'Record that the staff member received the photo notice.',
  unknown_store: 'One of the selected stores no longer exists.',
  not_found: 'The incident was not found in your stores.',
  jpeg_or_png_required: 'Only JPEG or PNG photos can be uploaded.',
  corrupt: 'The photo could not be decoded.',
  too_small: 'The photo must be at least 200 × 200 pixels.',
  future: 'The date cannot be in the future.',
  not_a_store_responder: 'Choose people who respond at this store.',
};

/** 422 field error code -> message (handles parameterized codes such as max_365_days). */
export function fieldMessage(code: string | undefined | null, locale: Locale): string | null {
  if (!code) return null;
  const max = /^max_(\d+)_days$/.exec(code);
  if (max) return translate(locale, 'Choose a date within {n} days of today (organization privacy policy).', { n: max[1]! });
  const key = FIELD_MESSAGE[code];
  return key ? translate(locale, key) : fieldErrorText(code, locale);
}
