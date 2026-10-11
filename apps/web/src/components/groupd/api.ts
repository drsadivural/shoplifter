// Group D (enrollment, people, administration, settings) typed helpers for endpoints and
// response fields that src/api/endpoints.ts and src/api/types.ts do not cover yet.
// Verified against services/api/src/retailguard_api/routers/{profiles,org,ops,privacy,auth}.py.
import { http, type RequestOptions } from '../../api/client';
import type {
  AuditEntry,
  Id,
  IncidentChannel,
  IncidentOutcome,
  IncidentStatus,
  Locale,
  OrgSettings,
  Paged,
  Photo,
  Profile,
  ProfileKind,
  ProfileStatus,
  Timestamp,
} from '../../api/types';

type Opts = Pick<RequestOptions, 'signal' | 'timeoutMs' | 'authRedirect'>;
const enc = encodeURIComponent;

/** Profile list/detail rows also carry the first usable photo's thumbnail and the last action reason. */
export interface ProfileRow extends Profile {
  thumb_media_id: Id | null;
  review_reason?: string | null;
}

/** GET /v1/profiles/{id}: linked incidents are a slim projection, history carries audit detail. */
export interface ProfileDetailD extends ProfileRow {
  photos: PhotoD[];
  linked_incidents: {
    id: Id;
    ref: string;
    channel: IncidentChannel;
    status: IncidentStatus;
    outcome: IncidentOutcome | null;
    captured_at: Timestamp;
  }[];
  history: { at: Timestamp; action: string; actor: string | null; detail?: Record<string, unknown> | null }[];
  match_candidates: { available: boolean; reason?: string };
}

export interface PhotoD extends Omit<Photo, 'profile_kind' | 'profile_reference' | 'quality'> {
  profile_kind?: ProfileKind;
  profile_reference?: string;
  reviewed_by?: Id | null;
  review_reason?: string | null;
  quality: {
    image: { sharpness: number; brightness: number; width: number; height: number; problems?: string[]; method?: string };
    face: { status: string; reason?: string };
  };
}

export interface AuditEntryD extends AuditEntry {
  actor_kind?: string;
  hash?: string | null;
}

export interface AuditVerify {
  valid: boolean;
  checked: number;
  head?: string | null;
  broken_at?: Id;
}

/** Server General settings: default_locale also accepts "browser" (follow the browser languages). */
export interface GeneralSettingsD {
  default_locale: 'browser' | Locale;
  session_timeout_minutes: number;
  currency: 'JPY' | 'USD' | 'EUR';
}

export interface NotificationRoutingSettings {
  behavior: boolean;
  watchlist: boolean;
  checkout: boolean;
  rfid: boolean;
  sound: boolean;
}

export interface LegalHold {
  id: Id;
  ref: string;
  store_id: Id;
  captured_at: Timestamp;
  legal_hold_reason: string;
  legal_hold_review_at: Timestamp;
  placed_by: string | null;
  review_overdue: boolean;
}

export type PrivacyRequestKind = 'access' | 'correction' | 'deletion';

export interface PrivacyRequest {
  id: Id;
  kind: PrivacyRequestKind;
  subject_reference: string;
  received_at: Timestamp;
  due_at: Timestamp;
  notes: string;
  status: 'open' | 'completed' | 'rejected';
  resolution: string | null;
  created_by: Id;
  completed_by: Id | null;
  completed_at: Timestamp | null;
  version: number;
  created_at: Timestamp;
  overdue: boolean;
}

export interface SupportBundleD {
  id: Id;
  media_id: Id;
  download_url: string;
  expires_at: Timestamp;
  support_contact: string | null;
}

export interface InvitationRow {
  id: Id;
  email: string;
  role: string;
  store_ids: Id[];
  expires_at: Timestamp;
  created_at: Timestamp;
}

export const gd = {
  org: {
    getGeneral: (o?: Opts) => http.get<OrgSettings<GeneralSettingsD>>('/v1/org/settings/general', undefined, o),
    putGeneral: (body: { expected_version: number; settings: GeneralSettingsD }, o?: Opts) =>
      http.put<OrgSettings<GeneralSettingsD>>('/v1/org/settings/general', body, o),
  },
  profiles: {
    list: (p: { kind?: ProfileKind; status?: ProfileStatus | ''; q?: string; store_id?: Id }, o?: Opts) =>
      http.get<Paged<ProfileRow>>('/v1/profiles', { kind: p.kind, status: p.status || undefined, q: p.q || undefined, store_id: p.store_id }, o),
    get: (id: Id, o?: Opts) => http.get<ProfileDetailD>(`/v1/profiles/${enc(id)}`, undefined, o),
    /** PATCH returns the full detail (same shape as GET). */
    update: (id: Id, body: Record<string, unknown> & { expected_version: number }, o?: Opts) =>
      http.patch<ProfileDetailD>(`/v1/profiles/${enc(id)}`, body, o),
  },
  photos: {
    list: (p: { kind?: ProfileKind; status?: string }, o?: Opts) =>
      http.get<Paged<PhotoD>>('/v1/photos', { kind: p.kind, status: p.status || undefined }, o),
  },
  users: {
    resetMfa: (id: Id, o?: Opts) => http.post<{ ok: true }>(`/v1/users/${enc(id)}/mfa/reset`, {}, o),
    invitations: (o?: Opts) => http.get<Paged<InvitationRow>>('/v1/users/invitations', undefined, o),
  },
  audit: {
    list: (
      p: { actor_id?: Id; action?: string; store_id?: Id; from?: string; to?: string; result?: string; cursor?: string | null; limit?: number },
      o?: Opts,
    ) => http.get<Paged<AuditEntryD>>('/v1/audit', p, o),
    verify: (o?: Opts) => http.get<AuditVerify>('/v1/audit/verify', undefined, o),
  },
  privacy: {
    holds: (o?: Opts) => http.get<Paged<LegalHold>>('/v1/privacy/holds', undefined, o),
    releaseHold: (incidentId: Id, body: { reason: string }, o?: Opts) =>
      http.post<{ incident_id: Id; legal_hold_reason: null }>(`/v1/incidents/${enc(incidentId)}/legal-hold/release`, body, o),
    requests: (o?: Opts) => http.get<Paged<PrivacyRequest>>('/v1/privacy/requests', undefined, o),
    createRequest: (body: { kind: PrivacyRequestKind; subject_reference: string; received_at: string; notes: string }, o?: Opts) =>
      http.post<PrivacyRequest>('/v1/privacy/requests', body, o),
    completeRequest: (id: Id, body: { expected_version: number; status: 'completed' | 'rejected'; resolution: string }, o?: Opts) =>
      http.post<PrivacyRequest>(`/v1/privacy/requests/${enc(id)}/complete`, body, o),
  },
  support: {
    createBundle: (body: { category: string; store_id?: Id; consent: true; description: string }, o?: Opts) =>
      http.post<SupportBundleD>('/v1/support/bundles', body, o),
  },
};
