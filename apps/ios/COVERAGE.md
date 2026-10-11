# iOS screen coverage — ios-01 … ios-34

Source of truth for screen IDs/fields: `design/screens.json` (platform `ios`) and
`docs/SCREEN_SPEC.md`. API contract: `docs/API_V1.md`. Paths below are relative
to `apps/ios/RetailGuard/`.

Status legend: **Implemented (unbuilt)** = SwiftUI source written and syntax-checked
(`swiftc -parse`) on Linux, wired to the API through `RetailGuardCore`, but **not
compiled, run or screenshot-verified** (no Xcode/simulator in the authoring
environment). Nothing in this table has been device-tested.

Common states: every data screen renders `Loading` (`LoadingStateView`), `Error`
with request ID + Retry (`FailureStateView`), `Offline` (banner + last data kept),
`Permission denied` (`PermissionDeniedView`, driven by `/v1/me` permissions and by
403 responses) and an explicit `Empty` state. Session expiry (401) from any
screen routes to ios-33 and keeps drafts.

| ID | Screen | SwiftUI view (file) | API endpoints | States / notes |
|---|---|---|---|---|
| ios-01 | Welcome | `WelcomeView` (Features/Auth/WelcomeView.swift) | `GET /v1/auth/config` (validates workspace) | loading (Continue spinner), error (invalid/insecure origin, unreachable), language switch EN/日本語, "Need assistance?" sheet with `support_contact`. Company workspace = API origin (HTTPS only; HTTP loopback in Debug). |
| ios-02 | Sign in | `LoginView` (Features/Auth/WelcomeView.swift) | `POST /v1/auth/login` (`client:"ios"`), `POST /v1/auth/password-reset/request` | inline field validation, 401 `invalid_credentials` (same message for unknown email), 429 rate limit, reset "sent" message identical for all emails. Company SSO: explanatory notice only when `oidc_enabled` (contract issues no bearer token via OIDC — see README). |
| ios-03 | Verify sign-in | `MFAView` (Features/Auth/MFAView.swift) | `POST /v1/auth/mfa/verify`, `GET /v1/auth/mfa/setup`, `POST /v1/auth/mfa/enable` | TOTP or recovery code, trusted device, 401 `invalid_code`; enrollment mode (setup key, open authenticator, recovery codes shown once). Partial token kept in memory only until MFA completes. |
| ios-04 | Enable Face ID | `FaceIDSetupView` (Features/Auth/OnboardingViews.swift); `LockedView` for unlock | none (LocalAuthentication) | available / not enrolled / denied (Open Settings) / locked out / unavailable; "Later" keeps password sign-in. Unlocks the retained Keychain session only. |
| ios-05 | Enable notifications | `NotificationPermissionView` (Features/Auth/OnboardingViews.swift) | `POST /v1/push/devices` (after APNs token) | not determined → system prompt; denied → Open Settings; Later. Explains private lock-screen text. |
| ios-06 | Select stores | `StoreSelectionView` (Features/Home/StoreSelectionView.swift) | `GET /v1/stores` (cursor) | loading, empty (no stores assigned), error, load more; "Assigned access only". |
| ios-07 | Store overview | `HomeView` (Features/Home/HomeView.swift) | `GET /v1/dashboard?store_id=`, `GET /v1/incidents?assignee=me&status=acknowledged|reviewing` | permission (`dashboard.read`), null median shown as "not enough data" (never 0), metrics link to filtered records, Swift Charts trend, camera health, last refresh, store tools links. |
| ios-08 | Live alerts | `AlertsView` (Features/Alerts/AlertsView.swift) | `GET /v1/incidents` (channel/status/assignee/q/cursor), polled every 30 s while visible | filters Behavior/Watchlist/Checkout/RFID/Assigned to me + status menu; empty → ios-32; offline keeps last list; push only triggers a reload (never acknowledges). |
| ios-09 | Review alert | `AlertDetailView` (Features/Alerts/AlertDetailView.swift) | `GET /v1/incidents/{id}`, `GET /v1/media/{id}` (frame), commands below | evidence pending/unavailable/expired states, raw signals labelled "not probabilities", uncertainty, timeline, allowed actions from state machine, conflict banner with Refresh, local draft notice. Also the push-tap destination. |
| ios-10 | Evidence player | `EvidencePlayerView` (Features/Alerts/EvidencePlayerView.swift) | `GET /v1/media/{id}` (bearer, downloaded to protected temp file) | downloading, failed (401/403/404/expired → message + retry), playback error → "Download again", speed 0.5–2×, ±5 s seek, in-place full screen; file deleted on dismiss and purged at launch/sign-out. Trigger offset not in contract (see README). |
| ios-11 | Take ownership | `AcknowledgeView` (Features/Alerts/ResponseForms.swift) | `POST /v1/incidents/{id}/claim {expected_version}` | 409 `owned_by_another_responder` → current state + Refresh (no retry), Escalate link. |
| ios-12 | Record outcome | `OutcomeView` (Features/Alerts/ResponseForms.swift) | `POST /v1/incidents/{id}/outcome {expected_version, outcome, reason, observed_behavior, loss_value, recovered_value}`; drafts via `GET /v1/incidents/{id}` first | inline validation (reason required, amounts, confirmed blocked while evidence pending), offline → local draft, draft submit = refresh-before-submit (`DraftSubmitter`), conflict card with explicit "apply draft to version N" / discard. |
| ios-13 | Request assistance | `EscalateView` (Features/Alerts/ResponseForms.swift) | `GET /v1/team?store_id=`, `POST /v1/incidents/{id}/escalate {expected_version, reason, priority}` | on-duty team list, priority, reason required, 409 handling. "Notify backup" is policy-driven server side (no field in contract). |
| ios-14 | Incident details | `IncidentDetailView` (Features/Alerts/IncidentDetailView.swift) | `GET /v1/incidents/{id}`, `POST …/notes`, `POST …/request-review`, `POST …/reopen`, media | evidence list, outcome + reviews, notes (add), history, related visits link, cases (read-only), enroll-from-confirmed-incident link. |
| ios-15 | Past records | `HistoryView` (Features/Records/HistoryView.swift) | `GET /v1/incidents?status=resolved&from&to&outcome&channel` | store-time date range, filters, empty, load more. |
| ios-16 | Search records | `SearchView` (Features/Records/SearchView.swift) | `GET /v1/search` (via results), `POST /v1/search/photo` (multipart) | permission `search.metadata` / `search.photo`; photo validated on device (JPEG/PNG, ≥200 px, ≤8 MB, ≤40 MP); 503 `face_sdk_unavailable` → explicit "Photo search unavailable"; 422 inline; query photo discarded after request. |
| ios-17 | Search results | `SearchResultsView` (Features/Records/SearchResultsView.swift) | `GET /v1/search` (cursor) or held photo-search response | coverage card (retention cutoff, gaps by reason), empty, rank shown only for photo search and labelled "not a probability", Open evidence. |
| ios-18 | Watchlist | `ProfileListView(kind: .watchlist)` (Features/Profiles/ProfileListView.swift) | `GET /v1/profiles?kind=watchlist&status=&q=&store_id=` | permission `profile.read`, status filter (default approved), search, empty, add (watchlist.manage). |
| ios-19 | Subject profile | `ProfileDetailView` (Features/Profiles/ProfileDetailView.swift) | `GET /v1/profiles/{id}`, `POST /v1/profiles/{id}/{submit|approve|reject|suspend|reinstate|delete}`, `POST …/photos` | photos (thumbs via media), basis, supporting incident, scope, expiry/review, gallery state, visit candidates = explicit unavailable state, linked incidents, history, lifecycle actions with reason + version, 409 refresh. |
| ios-20 | Enroll subject | `SubjectEnrollView` (Features/Profiles/EnrollViews.swift) | `GET /v1/incidents?status=resolved&outcome=confirmed`, `POST /v1/profiles` (watchlist) | requires a confirmed incident, basis, ≥1 store, expiry/review dates in store time; creates **draft** only. |
| ios-21 | Staff | `ProfileListView(kind: .staff)` (Features/Profiles/ProfileListView.swift) | `GET /v1/profiles?kind=staff…` | as ios-18; enrollment status + gallery state badges. |
| ios-22 | Enroll staff | `StaffEnrollView` (Features/Profiles/EnrollViews.swift) | `POST /v1/profiles` (staff) | employee ID, name, role context, stores, notice recorded required, expiry. |
| ios-23 | Capture reference photo | `PhotoCaptureView` + `CameraCaptureModel` (Features/Profiles/PhotoCaptureView.swift) | `POST /v1/profiles/{id}/photos` (multipart `file`, `provenance`) | camera permission not determined/denied (Open Settings)/restricted/unavailable, framing guide, retake, PhotosPicker fallback, provenance required, upload progress, offline error; never auto-approved. |
| ios-24 | Review photo quality | `PhotoQualityView` (Features/Profiles/PhotoQualityView.swift) | `GET /v1/profiles/{id}`, `GET /v1/media/{id}`, `POST …/photos/{pid}/review`, `DELETE …/photos/{pid}` | sharpness/exposure raw values, face count/pose = "Unavailable" (face SDK), approve/reject with reason, delete with confirmation. |
| ios-25 | Visit timeline | `VisitTimelineView` (Features/Alerts/IncidentDetailView.swift) | `GET /v1/incidents/{id}/visit`, `GET /v1/incidents/{id}` | `available:false, reason: reid_unavailable` → explicit unavailable state; lists only this incident's own camera events; association uncertainty "Not assessed". |
| ios-26 | Cameras | `CamerasView`, `CameraTile` (Features/Cameras/CameraViews.swift) | `GET /v1/cameras?store_id=` (cursor), media snapshots | readiness + analysis state badges, stale-frame badge, empty, permission `camera.read`. No addresses/credentials shown. |
| ios-27 | Camera preview | `CameraPreviewView` (Features/Cameras/CameraViews.swift) | `GET /v1/cameras/{id}`, `GET /v1/cameras/{id}/zones`, `GET /v1/media/{id}` | live view = explicit "not available on mobile" + latest privacy-masked snapshot with capture time, refresh, connection status, last frame freshness, channel states with reasons, privacy-mask count. |
| ios-28 | Notification preferences | `NotificationPreferencesView` (Features/Settings/NotificationPreferencesView.swift) | `PATCH /v1/me/preferences {notification_prefs}`, `GET /v1/me` | stores, types, sound, quiet hours, private preview (always on), device permission + push registration status (incl. 503 `push_unconfigured`). |
| ios-29 | Account & security | `AccountView` (Features/Settings/AccountView.swift) | `GET /v1/me/sessions`, `DELETE /v1/me/sessions/{id}`, `PATCH /v1/me/preferences {locale, theme}`, `POST /v1/auth/logout`, `DELETE /v1/push/devices/{id}` | Face ID toggle (states), sessions + revoke, language System/English/日本語, appearance System/Light/Dark, sign-out confirmation. |
| ios-30 | Response team | `TeamView` (Features/Settings/TeamAndHelpViews.swift) | `GET /v1/team?store_id=`, `GET /v1/stores/{id}` (manager name) | on/off duty, roles, store manager, "Contact via approved channel" guidance (no personal contact data). |
| ios-31 | Offline mode | `OfflineView`, `DraftOutcomeSheet` (Features/Status/OfflineView.swift) | `GET /v1/me`, `GET /v1/incidents/{id}` (draft refresh), outcome via ios-12 | last synced, pending drafts (refresh / review & submit / discard), redacted ≤12 h inbox snapshot, Reconnect. Also shown at launch when offline with a retained session. |
| ios-32 | All caught up | `AllCaughtUpView` (Features/Alerts/AlertsView.swift) | `GET /v1/dashboard` | true zero state, cameras online/analyzing (warns when none analyzing), last sync, View past records. |
| ios-33 | Session expired | `SessionExpiredView` (Features/Auth/OnboardingViews.swift) | — (routes to ios-02) | lists drafts kept on device, Sign in again, Company SSO notice. |
| ios-34 | Help & diagnostics | `HelpView` (Features/Settings/TeamAndHelpViews.swift) | `POST /v1/support/bundles`, `GET /v1/auth/config`, `GET /v1/health/system` (if `health.read`) | camera/notification guidance, category/store/description/consent validation, bundle reference + expiry, support contact, on-device diagnostics without secrets. |

## Cross-cutting

| Concern | Where |
|---|---|
| Bearer session in Keychain (`WhenUnlockedThisDeviceOnly`) | Services/KeychainTokenStore.swift |
| Face ID app unlock (never watchlist enrollment) | Services/BiometricAuth.swift, App/AppState.swift (`unlockWithBiometrics`, relock after 60 s in background) |
| APNs registration (sandbox Debug / production Release) | Services/PushManager.swift, App/RetailGuardApp.swift (AppDelegate) |
| Push tap → authenticate → fetch → detail | AppDelegate → `AppState.handleNotificationTap` → ios-09 (fetches current incident; 403/404 shown as not available) |
| Payload allow-list (incident_id + generic text only) | RetailGuardCore/Push/PushPayload.swift |
| expected_version + 409 handling | Features/Alerts/IncidentController.swift, ProfileDetailView |
| Offline drafts, refresh-before-submit | RetailGuardCore/Offline/*, Features/Alerts/ResponseForms.swift, Features/Status/OfflineView.swift |
| Store-timezone display | RetailGuardCore/Time/StoreTime.swift, `AppState.format` |
| Language override + String Catalogs | Services/Localization.swift, Resources/Localizable.xcstrings, Resources/InfoPlist.xcstrings |
| Appearance override + asset colors | Services/AppPreferences.swift, Resources/Assets.xcassets, Design/Theme.swift |
