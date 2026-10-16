// Typed wrappers for every /v1 endpoint in docs/API_V1.md used by the browser.
// Usage: `const page = await endpoints.incidents.list({ store_id, cursor }, { signal })`.
// Every function accepts an optional trailing RequestOptions-like `{ signal }`.
import { apiUpload, http, type RequestOptions, type UploadOptions } from './client';
import type {
  AppNotification,
  AuditEntry,
  AuthConfig,
  Camera,
  CameraImportResult,
  CameraZones,
  CaseDetail,
  CaseSummary,
  Dashboard,
  DetectionChannel,
  DiscoveryJob,
  Edge,
  Export,
  GeneralSettings,
  Id,
  Incident,
  IncidentListParams,
  IncidentOutcome,
  IncidentPriority,
  IncidentSummary,
  Integration,
  Invitation,
  Locale,
  LoginResponse,
  Me,
  MfaEnableResponse,
  MfaSetup,
  ModelEntry,
  NotificationPrefs,
  Org,
  OrgSettings,
  Paged,
  Photo,
  PrivacySettings,
  Profile,
  ProfileAction,
  ProfileDetail,
  ProfileKind,
  Redaction,
  ReportSummary,
  RolesMatrix,
  SearchResponse,
  SessionInfo,
  Store,
  StoreDetail,
  StorePolicy,
  StorePolicyKind,
  SupportBundle,
  SystemHealth,
  TeamMember,
  ThemePreference,
  User,
  Visit,
  Zone,
} from './types';

type Opts = Pick<RequestOptions, 'signal' | 'timeoutMs' | 'authRedirect'>;
type PageParams = { cursor?: string | null; limit?: number };
const enc = encodeURIComponent;

export const endpoints = {
  auth: {
    config: (o?: Opts) => http.get<AuthConfig>('/v1/auth/config', undefined, { authRedirect: false, ...o }),
    login: (body: { email: string; password: string }, o?: Opts) =>
      http.post<LoginResponse>('/v1/auth/login', { ...body, client: 'web' }, { authRedirect: false, ...o }),
    mfaVerify: (body: { code?: string; recovery_code?: string; trust_device?: boolean }, o?: Opts) =>
      http.post<{ state: 'authenticated' }>('/v1/auth/mfa/verify', body, { authRedirect: false, ...o }),
    mfaSetup: (o?: Opts) => http.get<MfaSetup>('/v1/auth/mfa/setup', undefined, { authRedirect: false, ...o }),
    mfaEnable: (body: { code: string }, o?: Opts) =>
      http.post<MfaEnableResponse>('/v1/auth/mfa/enable', body, { authRedirect: false, ...o }),
    logout: (o?: Opts) => http.post<{ ok: true }>('/v1/auth/logout', {}, { authRedirect: false, ...o }),
    /** Full-page navigation target (302 to IdP). Do not fetch it. */
    oidcStartUrl: '/v1/auth/oidc/start',
    passwordResetRequest: (body: { email: string }, o?: Opts) =>
      http.post<{ ok: true }>('/v1/auth/password-reset/request', body, { authRedirect: false, ...o }),
    passwordResetComplete: (body: { token: string; new_password: string }, o?: Opts) =>
      http.post<{ ok: true }>('/v1/auth/password-reset/complete', body, { authRedirect: false, ...o }),
    acceptInvitation: (body: { token: string; display_name: string; password: string }, o?: Opts) =>
      http.post<{ ok: true }>('/v1/auth/invitations/accept', body, { authRedirect: false, ...o }),
  },

  me: {
    get: (o?: Opts) => http.get<Me>('/v1/me', undefined, o),
    updatePreferences: (
      body: { locale?: Locale; theme?: ThemePreference; notification_prefs?: NotificationPrefs },
      o?: Opts,
    ) => http.patch<Me>('/v1/me/preferences', body, o),
    sessions: (o?: Opts) => http.get<{ items: SessionInfo[] }>('/v1/me/sessions', undefined, o),
    revokeSession: (id: Id, o?: Opts) => http.del<void>(`/v1/me/sessions/${enc(id)}`, o),
    changePassword: (body: { current_password: string; new_password: string }, o?: Opts) =>
      http.post<{ ok: true; other_sessions_revoked: number }>('/v1/me/password', body, o),
    disableMfa: (body: { password?: string; code?: string; recovery_code?: string }, o?: Opts) =>
      http.post<{ ok: true }>('/v1/me/mfa/disable', body, o),
  },

  org: {
    get: (o?: Opts) => http.get<Org>('/v1/org', undefined, o),
    update: (body: Partial<Pick<Org, 'name' | 'timezone' | 'region' | 'primary_admin_id'>> & { expected_version: number }, o?: Opts) =>
      http.patch<Org>('/v1/org', body, o),
    getSettings: <K extends 'general' | 'privacy'>(kind: K, o?: Opts) =>
      http.get<OrgSettings<K extends 'general' ? GeneralSettings : PrivacySettings>>(`/v1/org/settings/${kind}`, undefined, o),
    putSettings: <K extends 'general' | 'privacy'>(
      kind: K,
      body: { expected_version: number; settings: K extends 'general' ? GeneralSettings : PrivacySettings },
      o?: Opts,
    ) => http.put<OrgSettings<K extends 'general' ? GeneralSettings : PrivacySettings>>(`/v1/org/settings/${kind}`, body, o),
  },

  stores: {
    list: (p: PageParams = {}, o?: Opts) => http.get<Paged<Store>>('/v1/stores', p, o),
    create: (body: Pick<Store, 'name' | 'region' | 'address' | 'timezone' | 'manager_name' | 'opening_hours'>, o?: Opts) =>
      http.post<Store>('/v1/stores', body, o),
    get: (id: Id, o?: Opts) => http.get<StoreDetail>(`/v1/stores/${enc(id)}`, undefined, o),
    update: (id: Id, body: Partial<Store> & { expected_version: number }, o?: Opts) =>
      http.patch<Store>(`/v1/stores/${enc(id)}`, body, o),
    getPolicy: <S = Record<string, unknown>>(id: Id, kind: StorePolicyKind, o?: Opts) =>
      http.get<StorePolicy<S>>(`/v1/stores/${enc(id)}/policies/${kind}`, undefined, o),
    putPolicy: <S = Record<string, unknown>>(id: Id, kind: StorePolicyKind, body: { expected_version: number; settings: S }, o?: Opts) =>
      http.put<StorePolicy<S>>(`/v1/stores/${enc(id)}/policies/${kind}`, body, o),
    createPairingCode: (id: Id, body: { device_name: string }, o?: Opts) =>
      http.post<{ code: string; expires_at: string }>(`/v1/stores/${enc(id)}/edge-pairing-codes`, body, o),
  },

  users: {
    list: (p: PageParams = {}, o?: Opts) => http.get<Paged<User>>('/v1/users', p, o),
    update: (id: Id, body: { expected_version: number; role?: User['role']; store_ids?: Id[]; active?: boolean }, o?: Opts) =>
      http.patch<User>(`/v1/users/${enc(id)}`, body, o),
    invite: (body: { email: string; role: User['role']; store_ids: Id[]; expires_in_days: number }, o?: Opts) =>
      http.post<{ id: Id; accept_url: string; expires_at: string }>('/v1/users/invitations', body, o),
    invitations: (o?: Opts) => http.get<Paged<Invitation>>('/v1/users/invitations', undefined, o),
    revokeInvitation: (id: Id, o?: Opts) => http.del<void>(`/v1/users/invitations/${enc(id)}`, o),
    passwordResetLink: (id: Id, o?: Opts) =>
      http.post<{ reset_url: string; expires_at: string }>(`/v1/users/${enc(id)}/password-reset-link`, {}, o),
    revokeSessions: (id: Id, o?: Opts) => http.post<{ ok: true }>(`/v1/users/${enc(id)}/sessions/revoke`, {}, o),
  },

  roles: (o?: Opts) => http.get<RolesMatrix>('/v1/roles', undefined, o),
  team: (storeId: Id, o?: Opts) => http.get<{ items: TeamMember[] }>('/v1/team', { store_id: storeId }, o),

  edges: {
    list: (o?: Opts) => http.get<Paged<Edge>>('/v1/edges', undefined, o),
    revoke: (id: Id, body: { reason: string }, o?: Opts) => http.post<Edge>(`/v1/edges/${enc(id)}/revoke`, body, o),
  },

  cameras: {
    list: (p: { store_id?: Id } & PageParams = {}, o?: Opts) => http.get<Paged<Camera>>('/v1/cameras', p, o),
    create: (
      body: {
        store_id: Id;
        name: string;
        location: string;
        address: string;
        username?: string;
        password?: string;
        stream_profile: Camera['stream_profile'];
        rtsp_path?: string;
      },
      o?: Opts,
    ) => http.post<Camera>('/v1/cameras', body, o),
    /** Manual add by RTSP URL. A user:password@ part in the URL is sealed to the edge and never stored. */
    createRtsp: (
      body: { store_id: Id; name: string; location: string; url: string; username?: string; password?: string },
      o?: Opts,
    ) => http.post<Camera>('/v1/cameras/rtsp', body, o),
    import: (body: { store_id: Id; csv: string; username?: string; password?: string; dry_run: boolean }, o?: Opts) =>
      http.post<CameraImportResult>('/v1/cameras/import', body, o),
    get: (id: Id, o?: Opts) => http.get<Camera>(`/v1/cameras/${enc(id)}`, undefined, o),
    update: (id: Id, body: { expected_version: number; name?: string; location?: string }, o?: Opts) =>
      http.patch<Camera>(`/v1/cameras/${enc(id)}`, body, o),
    provision: (id: Id, o?: Opts) => http.post<{ command_id: Id }>(`/v1/cameras/${enc(id)}/provision`, {}, o),
    activate: (id: Id, body: { expected_version: number; channels: DetectionChannel[] }, o?: Opts) =>
      http.post<Camera>(`/v1/cameras/${enc(id)}/activate`, body, o),
    pause: (id: Id, body: { expected_version: number }, o?: Opts) => http.post<Camera>(`/v1/cameras/${enc(id)}/pause`, body, o),
    getZones: (id: Id, o?: Opts) => http.get<CameraZones>(`/v1/cameras/${enc(id)}/zones`, undefined, o),
    putZones: (id: Id, body: { expected_version: number; zones: Zone[] }, o?: Opts) =>
      http.put<CameraZones>(`/v1/cameras/${enc(id)}/zones`, body, o),
  },

  discovery: {
    /** Without `interface` the edge probes from all of its private interfaces; USB cameras are listed too. */
    start: (body: { store_id: Id; interface?: string; timeout_s: number; cidr?: string; include_usb?: boolean }, o?: Opts) =>
      http.post<DiscoveryJob>('/v1/discovery-jobs', body, o),
    get: (id: Id, o?: Opts) => http.get<DiscoveryJob>(`/v1/discovery-jobs/${enc(id)}`, undefined, o),
    add: (
      id: Id,
      body: { endpoint: string; name: string; location: string; username: string; password: string; stream_profile: Camera['stream_profile'] },
      o?: Opts,
    ) => http.post<Camera>(`/v1/discovery-jobs/${enc(id)}/add`, body, o),
  },

  profiles: {
    list: (p: { kind?: ProfileKind; status?: string; q?: string; store_id?: Id } & PageParams = {}, o?: Opts) =>
      http.get<Paged<Profile>>('/v1/profiles', p, o),
    create: (body: Record<string, unknown> & { kind: ProfileKind }, o?: Opts) => http.post<Profile>('/v1/profiles', body, o),
    get: (id: Id, o?: Opts) => http.get<ProfileDetail>(`/v1/profiles/${enc(id)}`, undefined, o),
    update: (id: Id, body: Record<string, unknown> & { expected_version: number }, o?: Opts) =>
      http.patch<Profile>(`/v1/profiles/${enc(id)}`, body, o),
    uploadPhoto: (id: Id, file: File, provenance: string, uo?: UploadOptions) => {
      const form = new FormData();
      form.set('file', file);
      form.set('provenance', provenance);
      return apiUpload<Photo>(`/v1/profiles/${enc(id)}/photos`, form, uo);
    },
    reviewPhoto: (id: Id, photoId: Id, body: { decision: 'approved' | 'rejected'; reason: string }, o?: Opts) =>
      http.post<Photo>(`/v1/profiles/${enc(id)}/photos/${enc(photoId)}/review`, body, o),
    deletePhoto: (id: Id, photoId: Id, o?: Opts) => http.del<void>(`/v1/profiles/${enc(id)}/photos/${enc(photoId)}`, o),
    action: (id: Id, action: ProfileAction, body: { expected_version: number; reason: string }, o?: Opts) =>
      http.post<Profile>(`/v1/profiles/${enc(id)}/${action}`, body, o),
  },

  photos: {
    list: (p: { kind?: ProfileKind; status?: string } & PageParams = {}, o?: Opts) => http.get<Paged<Photo>>('/v1/photos', p, o),
  },

  incidents: {
    list: (p: IncidentListParams = {}, o?: Opts) => http.get<Paged<IncidentSummary>>('/v1/incidents', { ...p }, o),
    create: (body: { store_id: Id; camera_id?: Id; description: string; observed_at?: string }, o?: Opts) =>
      http.post<Incident>('/v1/incidents', body, o),
    get: (id: Id, o?: Opts) => http.get<Incident>(`/v1/incidents/${enc(id)}`, undefined, o),
    claim: (id: Id, body: { expected_version: number }, o?: Opts) => http.post<Incident>(`/v1/incidents/${enc(id)}/claim`, body, o),
    requestReview: (id: Id, body: { expected_version: number; reason: string }, o?: Opts) =>
      http.post<Incident>(`/v1/incidents/${enc(id)}/request-review`, body, o),
    outcome: (
      id: Id,
      body: {
        expected_version: number;
        outcome: IncidentOutcome;
        reason: string;
        observed_behavior?: string;
        loss_value?: number;
        recovered_value?: number;
      },
      o?: Opts,
    ) => http.post<Incident>(`/v1/incidents/${enc(id)}/outcome`, body, o),
    escalate: (id: Id, body: { expected_version: number; reason: string; priority: IncidentPriority }, o?: Opts) =>
      http.post<Incident>(`/v1/incidents/${enc(id)}/escalate`, body, o),
    reopen: (id: Id, body: { expected_version: number; reason: string }, o?: Opts) =>
      http.post<Incident>(`/v1/incidents/${enc(id)}/reopen`, body, o),
    addNote: (id: Id, body: { body: string }, o?: Opts) => http.post<Incident>(`/v1/incidents/${enc(id)}/notes`, body, o),
    visit: (id: Id, o?: Opts) => http.get<Visit>(`/v1/incidents/${enc(id)}/visit`, undefined, o),
    posEvents: (id: Id, o?: Opts) => http.get<{ items: Record<string, unknown>[] }>(`/v1/incidents/${enc(id)}/pos-events`, undefined, o),
  },

  cases: {
    list: (p: PageParams = {}, o?: Opts) => http.get<Paged<CaseSummary>>('/v1/cases', p, o),
    create: (body: { title: string; store_id?: Id; incident_ids?: Id[] }, o?: Opts) => http.post<CaseDetail>('/v1/cases', body, o),
    get: (id: Id, o?: Opts) => http.get<CaseDetail>(`/v1/cases/${enc(id)}`, undefined, o),
    linkIncident: (id: Id, incidentId: Id, o?: Opts) =>
      http.post<CaseDetail>(`/v1/cases/${enc(id)}/incidents`, { incident_id: incidentId }, o),
    unlinkIncident: (id: Id, incidentId: Id, o?: Opts) => http.del<CaseDetail>(`/v1/cases/${enc(id)}/incidents/${enc(incidentId)}`, o),
    addNote: (id: Id, body: { body: string }, o?: Opts) => http.post<CaseDetail>(`/v1/cases/${enc(id)}/notes`, body, o),
    close: (id: Id, body: { expected_version: number; reason: string }, o?: Opts) => http.post<CaseDetail>(`/v1/cases/${enc(id)}/close`, body, o),
    reopen: (id: Id, body: { expected_version: number; reason: string }, o?: Opts) =>
      http.post<CaseDetail>(`/v1/cases/${enc(id)}/reopen`, body, o),
  },

  exports: {
    /** idempotencyKey: generate once per user intent (crypto.randomUUID()) and reuse on retry. */
    create: (
      idempotencyKey: string,
      body: { case_id: Id; redaction: Redaction; reason: string; recipient: string; expires_in_days: number },
      o?: Opts,
    ) => http.post<Export>('/v1/exports', body, { ...o, headers: { 'Idempotency-Key': idempotencyKey } }),
    list: (p: PageParams = {}, o?: Opts) => http.get<Paged<Export>>('/v1/exports', p, o),
    get: (id: Id, o?: Opts) => http.get<Export>(`/v1/exports/${enc(id)}`, undefined, o),
    downloadUrl: (id: Id) => `/v1/exports/${enc(id)}/download`,
  },

  search: {
    query: (
      p: {
        from?: string;
        to?: string;
        store_id?: Id;
        camera_id?: Id;
        channel?: string;
        outcome?: string;
        assignee?: string;
        profile_id?: Id;
        evidence_state?: string;
      } & PageParams,
      o?: Opts,
    ) => http.get<SearchResponse>('/v1/search', p, o),
    photo: (file: File, uo?: UploadOptions) => {
      const form = new FormData();
      form.set('file', file);
      return apiUpload<unknown>('/v1/search/photo', form, uo);
    },
  },

  dashboard: (storeId: Id | undefined, o?: Opts) => http.get<Dashboard>('/v1/dashboard', { store_id: storeId }, o),

  reports: {
    summary: (p: { store_id?: Id; from?: string; to?: string }, o?: Opts) => http.get<ReportSummary>('/v1/reports/summary', p, o),
  },

  checkout: {
    exceptions: (p: { store_id?: Id } & PageParams, o?: Opts) =>
      http.get<Paged<IncidentSummary> & { pos_availability?: Record<string, unknown> }>('/v1/checkout/exceptions', p, o),
  },

  integrations: {
    list: (p: PageParams = {}, o?: Opts) => http.get<Paged<Integration>>('/v1/integrations', p, o),
    create: (body: { store_id: Id; kind: Integration['kind']; name: string; config?: Integration['config'] }, o?: Opts) =>
      http.post<Integration>('/v1/integrations', body, o),
    update: (id: Id, body: { expected_version: number; name?: string; config?: Integration['config'] }, o?: Opts) =>
      http.patch<Integration>(`/v1/integrations/${enc(id)}`, body, o),
    rotateSecret: (id: Id, o?: Opts) => http.post<{ webhook_secret: string }>(`/v1/integrations/${enc(id)}/rotate-secret`, {}, o),
  },

  models: {
    list: (p: PageParams = {}, o?: Opts) => http.get<Paged<ModelEntry>>('/v1/models', p, o),
    register: (body: { name: string; version: string; channel: string; manifest: Record<string, unknown> }, o?: Opts) =>
      http.post<ModelEntry>('/v1/models', body, o),
    action: (id: Id, action: 'license' | 'validate' | 'rollout' | 'rollback', body: Record<string, unknown> & { expected_version: number }, o?: Opts) =>
      http.post<ModelEntry>(`/v1/models/${enc(id)}/${action}`, body, o),
  },

  audit: {
    list: (
      p: { actor_id?: Id; action?: string; store_id?: Id; from?: string; to?: string; result?: string } & PageParams = {},
      o?: Opts,
    ) => http.get<Paged<AuditEntry>>('/v1/audit', p, o),
  },

  health: {
    system: (o?: Opts) => http.get<SystemHealth>('/v1/health/system', undefined, o),
    /** Liveness of the API process (no auth). */
    live: (o?: Opts) => http.get<unknown>('/healthz', undefined, { authRedirect: false, ...o }),
  },

  notifications: {
    list: (p: PageParams = {}, o?: Opts) => http.get<Paged<AppNotification>>('/v1/notifications', p, o),
    markRead: (ids?: Id[], o?: Opts) => http.post<{ ok: true }>('/v1/notifications/read', ids ? { ids } : {}, o),
  },

  support: {
    createBundle: (body: { category: string; store_id?: Id; consent: true; description: string }, o?: Opts) =>
      http.post<SupportBundle>('/v1/support/bundles', body, o),
  },
};

export type Endpoints = typeof endpoints;
