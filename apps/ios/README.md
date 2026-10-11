# RetailGuard iOS responder (`apps/ios`)

Native SwiftUI client for Ayonix RetailGuard store responders: sign-in with
MFA, Face ID app unlock, assigned stores, live alerts, evidence video,
claim / outcome / escalation with optimistic concurrency, history and
metadata/photo search, staff and watchlist enrollment with reference photos,
cameras, notifications, account, team, offline drafts and diagnostics. It
implements every iOS screen `ios-01 … ios-34` from `design/screens.json`
against the contract in `docs/API_V1.md` (see [COVERAGE.md](COVERAGE.md)).

> **Status: source complete, not built.** The authoring environment is Linux.
> Only the Foundation-only `RetailGuardCore` package has been compiled and
> tested here. The app target has **not** been compiled, run, signed or
> tested on a simulator or device. See "What was and was not verified".

## Layout

```
apps/ios/
├── project.yml                 XcodeGen spec (iOS 17, targets RetailGuard + RetailGuardTests)
├── Config/                     xcconfig files (API origin, APNs env, signing include)
│   ├── Base.xcconfig / Debug.xcconfig / Release.xcconfig
│   ├── Signing.xcconfig.example   → copy to Signing.xcconfig (git-ignored)
│   └── Local.xcconfig.example     → optional Debug API override (git-ignored)
├── Support/                    Info.plist (Release), Info-Debug.plist (+ATS local networking), entitlements
├── RetailGuardCore/            Swift package, Foundation only (models, API client, drafts, push parsing…)
├── RetailGuard/                App target (SwiftUI)
│   ├── App/                    @main, AppDelegate (APNs), AppState (session/navigation), routes
│   ├── Services/               Keychain, Face ID, push, network monitor, media, localization, preferences
│   ├── Design/                 tokens, components, state views, enum labels
│   ├── Features/               Auth, Home, Alerts, Records, Profiles, Cameras, Settings, Status
│   └── Resources/              Assets.xcassets, Localizable.xcstrings, InfoPlist.xcstrings, PrivacyInfo.xcprivacy
└── RetailGuardTests/           Hosted unit tests (catalog completeness, config, Keychain, error mapping)
```

The legacy reference client in `/ios` is untouched.

## Build on a Mac

Requirements: macOS with Xcode 16 or newer (iOS 17+ SDK; check Apple's current
minimum SDK for App Store submission), [XcodeGen](https://github.com/yonaskolb/XcodeGen) 2.40+.

```bash
cd apps/ios
cp Config/Signing.xcconfig.example Config/Signing.xcconfig   # set DEVELOPMENT_TEAM, bundle id
xcodegen generate
open RetailGuard.xcodeproj
```

Unsigned simulator build + tests (CI):

```bash
cd apps/ios && xcodegen generate
xcodebuild -project RetailGuard.xcodeproj -scheme RetailGuard \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  CODE_SIGNING_ALLOWED=NO build test
```

Core package tests (also runnable on Linux):

```bash
cd apps/ios/RetailGuardCore && swift build && swift test
```

### Configuration

| Setting | Debug | Release | Where |
|---|---|---|---|
| `RG_API_BASE_URL` (default workspace origin) | `https://shoplifter.ayonix.com` | `https://shoplifter.ayonix.com` (confirm before archiving) | `Config/*.xcconfig`, override in `Config/Local.xcconfig` / `Local.Release.xcconfig` |
| HTTP to loopback (`RG_ALLOW_INSECURE_LOOPBACK`) + ATS `NSAllowsLocalNetworking` | YES | NO | `Config/*.xcconfig`, `Support/Info-Debug.plist` |
| APNs registration environment (`RG_APNS_ENVIRONMENT`) | `sandbox` | `production` | sent to `POST /v1/push/devices` |
| `aps-environment` entitlement (`APS_ENVIRONMENT`) | `development` | `production` | `Support/RetailGuard.entitlements` |
| Bundle ID (`RG_BUNDLE_IDENTIFIER`) | `com.ayonix.retailguard.responder` | same | `Config/Base.xcconfig`, override in `Signing.xcconfig` |
| Team (`DEVELOPMENT_TEAM`) | empty | empty | **only** in git-ignored `Config/Signing.xcconfig` |

Users can also enter a company workspace origin on the welcome screen
(ios-01). Release builds accept HTTPS origins only; the origin is validated
with `GET /v1/auth/config` before sign-in.

## Security and privacy behaviour

- Bearer token from `POST /v1/auth/login` (`"client": "ios"`) stored in the
  Keychain with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, never synced.
  During MFA the partial token is kept in memory only.
- Face ID (LocalAuthentication) only unlocks the retained local session after
  launch or > 60 s in background. It never touches the store face-matching
  gallery. If Face ID is unavailable, denied, locked out or the user chooses
  "Sign in with password", normal sign-in remains available.
- Push: permission via `UNUserNotificationCenter`; APNs token posted to
  `POST /v1/push/devices` with the build's environment and bundle ID; removed on
  sign-out. Payloads are parsed with a strict allow-list (`incident_id` + generic
  text). A tap authenticates (Face ID lock if enabled), fetches the current
  incident and opens the detail screen; push is never treated as an
  acknowledgement or as durable storage. No Notification Service Extension;
  `mutable-content` payloads are rejected. A hidden-preview placeholder category
  is registered.
- Evidence clips are downloaded with the bearer header from `GET /v1/media/{id}`
  into a file-protected temporary file, played with AVKit and deleted when the
  player closes (directory purged at launch/sign-out). Thumbnails are cached in
  memory only.
- Outcome drafts (≤ 24 h, user-scoped, file-protected) are always flagged
  "refresh before submit": submission re-fetches the incident and aborts with a
  conflict if the version moved. Sign-out deletes drafts; session expiry keeps
  them.
- All transitions send `expected_version`; a 409 shows the current state with
  a Refresh action and is never retried automatically.
- Photos (reference and query) are re-encoded on device (drops EXIF/location)
  and pre-validated against the upload limits; face quality is not assessed on
  the device.

## TestFlight / App Store handoff

1. Register the App ID (`RG_BUNDLE_IDENTIFIER`) with the Push Notifications
   capability; create the APNs auth key **in the server/worker vault only**.
2. Fill `Config/Signing.xcconfig`, bump `MARKETING_VERSION` /
   `CURRENT_PROJECT_VERSION` in `Config/Base.xcconfig`, confirm the Release API
   origin, then Product → Archive (Release) and upload via Organizer or
   `xcodebuild -exportArchive`.
3. App icon: `Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` (1024×1024 RGB, no alpha,
   full-bleed square; iOS applies the rounded mask). Used for both light and dark appearances.
4. Review `Resources/PrivacyInfo.xcprivacy` (draft: UserDefaults CA92.1; email,
   photos, device push token, diagnostics — linked, app functionality, no
   tracking) and the App Privacy answers against the real backend; review
   `ITSAppUsesNonExemptEncryption = NO` (standard HTTPS only) with counsel.
5. App Store copy (EN/JA) is in `docs/IOS_RELEASE.md`. Screenshots must come
   from real builds, not the mockups.
6. Provide App Review a demo account on a live backend with synthetic data and
   explain hardware-dependent flows (cameras, face SDK unavailable states).
7. Run the device validation matrix in `docs/IOS_RELEASE.md` (small/large
   iPhones, light/dark, EN/JA, largest Dynamic Type, VoiceOver, Face ID
   denied/unavailable, camera/photos denied, push disabled, offline, stale
   incident with two responders, expired media, sign-out, background resume).
8. Internal TestFlight first; choose B2B distribution (public/unlisted/custom
   app) per customer. Approval is Apple's decision.

## What was and was NOT verified

Verified on Linux (Swift 6.1.3, x86_64):

- `RetailGuardCore`: `swift build` succeeds and `swift test` passes —
  65 XCTest cases, 0 failures (Swift 6.1.3, Linux). Tests cover JSON
  decoding of realistic payloads, error-body decoding and status mapping
  (401 session expired vs MFA, 409 `current_version`, 422 field errors,
  503 dependency unavailable, offline), request headers (bearer, request IDs,
  no bearer on login), query encoding, multipart layout, media download,
  conflict handling, draft refresh-before-submit with an injected transport,
  draft persistence/expiry, Asia/Tokyo formatting and store-day UTC ranges,
  the incident action state machine, outcome form validation, push payload
  allow-listing, image header validation and workspace URL policy.
- Every app-target Swift file passes `swiftc -parse` (syntax only).
- CI (`.github/workflows/ci.yml`, job `ios-app`, macOS 15 runner): `xcodegen generate` succeeds and the
  `RetailGuard` scheme builds for the iOS Simulator without signing (`** BUILD SUCCEEDED **`, 2026-10-11,
  after two compile fixes: main-actor default arguments in `AppState.init` and a defaulted `load()`
  passed as a retry closure).

NOT verified (requires a Mac / Xcode / devices):

- `RetailGuardTests` has not been run (CI builds the app target only).
- No simulator or device runs, no UI/accessibility audit (Dynamic Type,
  VoiceOver, contrast), no screenshot comparison against the mockups.
- No Keychain, Face ID, camera, PhotosPicker, AVKit playback or Charts runtime
  testing.
- No APNs sandbox/production delivery test, token rotation, notification tap
  from killed state, or lock-screen rendering check.
- No test against a running `services/api` instance (contract taken from
  `docs/API_V1.md`; ambiguities listed below).
- String Catalog compilation and the in-app language switch at runtime.

## Contract ambiguities handled defensively

- Login with `mfa_required`: assumes the iOS token is returned and is usable
  for `/v1/auth/mfa/*` (kept in memory until MFA completes).
- OIDC/SSO only yields a browser cookie session and a redirect to `/web`; there
  is no bearer handoff for iOS, so mobile SSO is presented as unavailable.
- Item shapes not specified: profile `linked_incidents`/`history`, visit
  `events`, `GET /v1/team` and `GET /v1/me/sessions` envelopes, note `author` /
  review `actor` (object or string), channel state (string or `{state, reason}`),
  `opening_hours`, `loss_value` (number or string). Decoders accept the variants.
- `GET /v1/incidents?status=` takes a single value; "open" (new+acknowledged+
  reviewing) cannot be requested in one call.
- `request-review` / `escalate` permitted roles and statuses are not stated;
  the client offers them to the assignee / non-owners as described in
  `RetailGuardCore/Domain/IncidentActions.swift`; the server decides.
- Evidence clips carry no trigger offset, so no trigger marker is drawn.
- Escalation has no "notify backup" field; backup notification is policy-side.
- Photo search success response shape is assumed to be `SearchResponse`.
- Support bundle `category` values are not enumerated (`camera`,
  `notification`, `access`, `other` used).
- Profile `expires_at`/`review_at`: sent as RFC 3339 end of store-local day.
- Quiet hours timezone (store vs user) is not specified.
- `POST /v1/incidents/{id}/notes` response shape unspecified; the incident is
  re-fetched afterwards.

## Known follow-ups

- `CameraCaptureModel.configure` runs on the main actor (session start/stop is
  on a background queue); move configuration to the session queue if capture
  setup causes UI hitches.
- Evidence playback downloads the whole clip before playing (no streaming,
  because AVPlayer cannot attach the bearer header); fine for short clips.
- Japanese strings were written for this release and should get a native
  reviewer pass (terminology follows `design/ja.json`).
