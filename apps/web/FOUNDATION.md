# RetailGuard web console — foundation guide

This guide explains the patterns used by the React console in `apps/web`. Read it before you build any of the remaining screens. The backend contract is in `docs/API_V1.md`. The screen contract (ids, routes, fields and titles) is in `design/screens.json`.

## 1. Stack and commands

| | |
|---|---|
| Runtime | React 19.2.8 with TypeScript 5.9.3 in strict mode (`noUncheckedIndexedAccess` is on). Routing uses react-router 7.18.4 in declarative mode. |
| Build | Vite 7.3.7. Output goes to `apps/web/dist` and is served at the site root by Caddy with SPA fallback. |
| Tests | Vitest 4.1.11, @testing-library/react 16 and jsdom 27 |
| Other dependencies | `qrcode` 1.5.4, used for MFA enrollment. There is no UI or CSS framework. |

```bash
npm ci
npm run dev            # http://localhost:5173 (proxy /v1 and /healthz to http://127.0.0.1:8710; override with RG_API_TARGET)
npm run typecheck      # tsc --noEmit
npm test -- --run      # vitest (CI runs exactly this)
npm run build          # typecheck + vite build -> dist/
npm run sync:design    # regenerate src/screens.generated.ts + src/i18n/design-ja.generated.json from design/
node scripts/i18n-keys.mjs   # list every i18n key used in src/
```

Fonts are self-hosted. `src/main.tsx` imports `@fonts/400.css` and `@fonts/700.css`, and `@fonts` is a Vite alias for the repository's `assets/fonts` directory (Noto Sans JP, OFL). Vite emits the woff2 subsets into `dist/assets`.

## 2. File layout

```
src/
  main.tsx                 entry (fonts + CSS + <App/>)
  App.tsx                  providers, <AppRoutes/>, ScreenRoute (permission gate + NotYetImplemented), error boundary
  routes.tsx               ★ screen id -> lazy page component (the ONLY file to touch when adding a page)
  routes.meta.ts           per-screen permission / layout / breadcrumb section / nav parent; NAV; screenPath()
  screens.generated.ts     GENERATED from design/screens.json (54 web screens)
  api/
    client.ts              fetch client, ApiError, CSRF, timeouts, 401 redirects, apiUpload (progress), mediaUrl
    endpoints.ts           typed wrappers for every /v1 endpoint (endpoints.incidents.claim(...), ...)
    types.ts               entity types (Me, Store, Camera, IncidentSummary, Incident, Profile, Photo, Paged<T>, ...)
    hooks.ts               useApiQuery, usePagedQuery, useMutation, errorMessageKey
    connectivity.ts        last successful sync / last failed request (used by web-54 and the shell banner)
  i18n/
    index.tsx              I18nProvider, useI18n (t, fmt, locale, setLocale), translate(), detectLocale()
    app.ts                 app-specific EN/JA strings  ← add new strings here
    design-ja.generated.json  GENERATED from design/ja.json + screen titles
  session/SessionProvider.tsx   GET /v1/me, can(), stores, selected store, timeZone, savePreferences, signOut
  shell/AppShell.tsx       sidebar, header (breadcrumbs, store selector, unread, language, theme, user menu), banner
  shell/AuthLayout.tsx     signed-out layout (login / MFA / reset / invite)
  components/              shared UI (inventory in §6)
  lib/format.ts            store-timezone date/time, relative time, duration, number, JPY helpers
  lib/theme.tsx            ThemeProvider (light/dark/system)
  lib/nav.ts               safeNext() for ?next= redirects
  hooks/                   useMediaQuery + BREAKPOINTS, useConnectivity
  pages/<key>.tsx          one file per screen, named by screens.json "key"
  styles/                  tokens.css, base.css, shell.css, components.css, pages.css
  test/                    setup.ts (matchMedia mock, cleanup) and utils.tsx (renderWithProviders, mockFetch, makeMe)
```

## 3. How to add a page

1. Find the screen in `design/screens.json`, for example `web-23`, key `incidents`, route `/web/incidents`. Look at the mockup in `mockups/web/{en,ja}/{light,dark}/web-23-incidents.png` and read its section in `docs/SCREEN_SPEC.md`.
2. Create `src/pages/incidents.tsx` with a **default export**:

```tsx
import { endpoints } from '../api/endpoints';
import { usePagedQuery } from '../api/hooks';
import type { IncidentSummary } from '../api/types';
import { DataTable, type Column } from '../components/DataTable';
import { IncidentStatusPill, OutcomePill } from '../components/domain';
import { PageHeader } from '../components/PageHeader';
import { ButtonLink } from '../components/primitives';
import { EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

export default function IncidentsPage() {
  const { t, fmt } = useI18n();
  const { store, timeZone } = useSession();
  const q = usePagedQuery(
    (cursor, signal) => endpoints.incidents.list({ store_id: store?.id, cursor: cursor ?? undefined }, { signal }),
    [store?.id],
    { enabled: Boolean(store) },
  );
  const columns: Column<IncidentSummary>[] = [
    { key: 'ref', header: t('Incident'), primary: true, render: (r) => r.ref },
    { key: 'status', header: t('Status'), render: (r) => <IncidentStatusPill status={r.status} /> },
    { key: 'outcome', header: t('Outcome'), render: (r) => <OutcomePill outcome={r.outcome} /> },
    { key: 'time', header: t('Time'), render: (r) => fmt.dateTime(r.captured_at, r.store_timezone ?? timeZone) },
  ];
  return (
    <>
      <PageHeader screenId="web-23" action={<ButtonLink to="/web/search">{t('Search')}</ButtonLink>} />
      <div className="card">
        <DataTable caption={t('Incident register')} query={q} columns={columns} rowKey={(r) => r.id}
          rowHref={(r) => screenPath('web-24', { id: r.id })}
          empty={<EmptyState title={t('No incidents recorded yet')} />} />
      </div>
    </>
  );
}
```

3. Register the page in `src/routes.tsx` by adding one line: `'web-23': lazy(() => import('./pages/incidents')),`
4. Add every new English string, with its Japanese, to `src/i18n/app.ts` (§5). The `catalog.test.ts` test fails when a string is missing.
5. Add `src/pages/incidents.test.tsx` using `renderWithProviders` and `mockFetch` (§10).
6. Check the result at 1440, 1024, 768 and 390 px, in light and dark, and in English and Japanese.

Rules that every page must follow:

* **Route.** The route, the eyebrow, the h1 and the subtitle come from `<PageHeader screenId=…/>`. Never hard-code a screen title.
* **Detail pages** take the record id from the query string (for example `/web/alert-detail?id=…`). Build the links with `screenPath('web-20', { id })`.
* **Permissions.** The route-level permission gate is applied automatically by `ScreenRoute` using `ROUTE_META[id].permission`. Inside the page, hide controls the user may not use: `can('incident.respond') && <Button …/>`. Do **not** render disabled buttons as a substitute. Hide the button, or explain why the action is not available.
* **No fabricated data.** Never seed, invent or default business values. A `null` metric is rendered as "unavailable", never as 0. A missing dependency (face SDK, model, edge, push or SSO) renders an `UnavailableNotice`.
* **Mutations** send `expected_version` and handle 409 with `ConflictBanner` plus a refetch. Never retry a stale command automatically.
* **Consequential actions** (reject, suspend, close, revoke, request review and so on) use `ConfirmDialog`, which requires a reason.
* **Media** is loaded only through `AuthenticatedImage` and `AuthenticatedVideo`. Never log media URLs or put them in toasts.

## 4. API layer

### Client (`api/client.ts`)

* The client is same-origin and always uses `credentials: 'include'`. Every non-GET request sends the header `X-CSRF-Token: <rg_csrf cookie>`.
* Every request has a timeout: 20 s by default, and 120 s for uploads (`timeoutMs` overrides it). A timeout raises `ApiError{status:0, code:'timeout'}`. Network failures raise `code:'network_error'`.
* `ApiError` exposes `status`, `code`, `message`, `requestId`, `retriable`, `fieldErrors`, `currentVersion`, and the helpers `isConflict`, `isForbidden`, `isNotFound`, `isUnavailable`, `isNetwork` and `isValidation`. When the body does not include a `request_id`, the `X-Request-ID` header is used instead.
* **401 handling.** `session_expired` and `authentication_required` redirect to `/web/login?next=<current path>`. `mfa_required` redirects to `/web/mfa?next=…`, and `mfa_enrollment_required` to `/web/mfa?enroll=1&next=…`. Pass `{ authRedirect: false }` to opt out; the `endpoints.auth.*` calls already do. `next` is sanitized with `safeNext()`, which only accepts `/web/...` paths.
* `apiUpload(path, formData, { onProgress })` uses XHR so it can report upload progress. `http.postForm` is the multipart variant without progress.
* `mediaUrl(mediaId, 'thumb'?)` returns `/v1/media/{id}`. Cookie authentication means a plain `<img>` or `<video>` element works.

### Endpoints (`api/endpoints.ts`)

Every endpoint in API_V1 has a typed function, for example `endpoints.dashboard(storeId, { signal })`, `endpoints.incidents.claim(id, { expected_version })`, `endpoints.profiles.uploadPhoto(id, file, provenance, { onProgress })` and `endpoints.exports.create(idempotencyKey, body)`. Use these functions; do not call `fetch` directly. If you find a field that is missing from `types.ts`, add it there; the generated `packages/contracts/openapi.json` response bodies are untyped.

API facts verified against `services/api` that go beyond the doc:

* `/v1/incidents` accepts comma lists for `status` and `channel`, as well as `priority`, `open=1`, `assignee=me|none|<id>` and `camera_id`.
* `IncidentSummary.store_timezone` is present; prefer it when formatting `captured_at`.
* `/v1/dashboard` also returns `preview: {camera_id, camera_name, media_id, captured_at} | null`, `cameras.analyzing`, `acknowledged_today` and `timezone`.
* `Incident.timeline[].action` values are audit action names such as `incident.ingested` or `incident.acknowledged`. They are translated through the `timeline|<action>` keys.

### Hooks (`api/hooks.ts`)

```ts
const q = useApiQuery((signal) => endpoints.incidents.get(id!, { signal }), [id], { enabled: Boolean(id), pollMs?: 15_000 });
// q.data | q.error (ApiError) | q.status | q.loading (no data yet) | q.fetching | q.reload() | q.setData(updated)

const list = usePagedQuery((cursor, signal) => endpoints.cameras.list({ store_id, cursor: cursor ?? undefined }, { signal }), [store_id]);
// list.items | list.hasMore | list.loadMore() | list.loadingMore | list.loadMoreError | list.reload() | list.setItems

const claim = useMutation((v: number) => endpoints.incidents.claim(id, { expected_version: v }), {
  successMessage: t('Alert acknowledged'),        // toast on success
  onSuccess: (updated) => q.setData(updated),      // show the server's returned entity (with new version)
  onError: (e) => { if (e.status === 409) { setConflict(true); q.reload(); return true; } }, // true = handled, no toast
});
const r = await claim.run(incident.version);       // never throws: { ok: true, data } | { ok: false, error }
claim.pending; claim.error; claim.fieldErrors;      // fieldErrors = 422 field_errors (code per field)
```

* When the deps change, the previous data is cleared, so data from another store never flashes on screen. Requests are aborted on unmount and whenever the deps change.
* `useMutation` ignores double submits. Unhandled failures show an error toast that includes the request id.
* Show inline field errors with `fieldErrorText(m.fieldErrors.name, locale)`, which uses the `field_error|<code>` keys.

## 5. i18n

* **Keys are the English source text.** `t('Open alerts')` returns 未対応アラート, taken from `design/ja.json`. App strings live in `src/i18n/app.ts`, in `APP_JA` (and in `APP_EN` only when the English text differs from the key).
* **Context-qualified keys** are used when the same English needs different Japanese: `'nav|Incidents'` gives 事案記録, while `'Incidents'` gives 事案数. English falls back to the text after the last `|`. The prefixes in use are `nav|`, `crumb|`, `status|`, `evidence|`, `priority|`, `readiness|`, `analysis|`, `edge|`, `channel|`, `outcome|`, `role|<role>`, `field_error|<code>`, `timeline|<audit action>`, `signal|<key>` and `uncertainty|<code>`.
* **Interpolation** uses named placeholders: `t('{count} unread notifications', { count })`. The Japanese text must keep the same placeholders; a test checks this.
* **Fallbacks.** A missing Japanese string falls back to English. **The tests fail for any literal `t('…')` key without Japanese** (`src/i18n/catalog.test.ts`). For dynamic keys built with template strings, add the key to the "dynamic keys" test.
* **Screen titles** come from `screen.title[locale]` (through `PageHeader`). **Catalog field labels** are already translated in `design/ja.json`; use the exact English field text as the key, for example `t('Median acknowledgement')`.
* **Language selection**, in order of priority:
  1. `me.user.locale` from the server, when it is set.
  2. An explicit choice stored in `localStorage` under `rg.locale`.
  3. `navigator.languages`: any `ja` or `ja-*` entry selects Japanese.
  4. English.

  The language is never inferred from the IP address. The header toggle calls `savePreferences({ locale })`, which updates localStorage and sends `PATCH /v1/me/preferences`. `<html lang>` is kept in sync.
* **Dates and times.** API timestamps are UTC and must always be displayed in the **store timezone**: `fmt.dateTime(iso, store.timezone, { withZone: true })` produces `2026-10-11 10:42:18 JST`. The other helpers are `fmt.time`, `fmt.date`, `fmt.relative(iso)` ("5 min. ago" or "5 分前"), `fmt.duration(s)` ("14 s" or "14秒"), `fmt.number` and `fmt.currency(n, 'JPY')`. Use `useSession().timeZone` for the selected store, or `incident.store_timezone` for a record. Never use the browser timezone.

## 6. Component inventory (`src/components`)

| Component | Key props | Notes |
|---|---|---|
| `PageHeader` | `screenId`, `title?`, `subtitle?`, `action?` | eyebrow + localized h1 + "<store> · Review evidence…"; sets document.title; h1 receives focus on navigation |
| `Button` | `variant` primary\|secondary\|danger\|ghost, `size` md\|sm, `pending`, `icon` | 44 px target; `pending` = spinner + aria-busy |
| `ButtonLink` | Link props + `variant`, `size`, `icon` | router link styled as a button |
| `Card` | `title`, `titleAddon`, `actions`, `headingLevel` | section labelled by its heading |
| `StatCard` | `label`, `value` (null ⇒ "—" + Unavailable), `caption`, `unavailableReason`, `to` | an unavailable value is visibly distinct from 0; `to` links to the filtered records |
| `Badge` / `StatusPill` | `tone` neutral\|ok\|info\|warning\|critical | text + glyph + color, never color alone |
| Domain pills (`domain.tsx`) | `IncidentStatusPill`, `OutcomePill`, `EvidenceStatePill`, `PriorityPill`, `ReadinessPill`, `AnalysisStatePill`, `EdgeStatePill`, `ChannelLabel` | standard labels and tones for every enum |
| `Notice` | `tone` warning\|info\|critical, `title?` | yellow left-rule note, for example "Impact is measured from reviewed incidents" |
| `FilterTabs` | `items`, `value`, `onChange`, `label` | segmented filter (aria-pressed) |
| `KeyValueList` | `items: {label, value}[]` | `<dl>` rows |
| `DataTable` | `columns: Column<T>[]` (`key`, `header`, `render`, `primary?`, `sortable?`, `align?`, `hideInCards?`), `rowKey`, `caption`, `query` (a usePagedQuery result) **or** `rows`/`loading`/`error`/`hasMore`/`onLoadMore`, `toolbar`, `empty`, `sort`/`onSortChange`, `rowHref`, `mode` auto\|table\|cards, `filterRows?` | "Load more" uses the cursor; renders cards under 768 px; renders the empty, error and loading states |
| `FormField` | `label`, `hint`, `error`, `required`, `children(controlProps)` | wires id, aria-describedby and aria-invalid; shows a required marker (*) |
| `TextField`, `SelectField` (`options`, `placeholder`), `TextAreaField` | field shorthands | |
| `TextInput`, `Select`, `TextArea`, `Checkbox`, `Toggle` (`role="switch"`) | | |
| `fieldErrorText(code, locale)` | | turns a 422 field error code into a message |
| `Modal` | `open`, `onClose`, `title`, `description`, `footer`, `dismissible`, `size` | focus trap, Esc, restores focus, portal |
| `ConfirmDialog` | `open`, `onClose`, `title`, `confirmLabel`, `onConfirm(reason) => Promise<boolean>`, `pending`, `requireReason` (default true), `minReasonLength`, `error` | the reason is mandatory and is recorded in the audit log |
| `Toast` (`useToast().show({tone, message, detail, requestId})`) | | errors are announced assertively and include the request id |
| `EmptyState` | `title`, `description`, `action`, `icon`, `compact` | a true zero state; never filler data |
| `ErrorState` | `error`, `onRetry`, `title`, `compact` | localized message, Retry button and request id |
| `LoadingState` | `variant` page\|table\|cards\|inline, `rows` | skeleton with role=status |
| `PermissionDenied` | `permission?` | |
| `UnavailableNotice` | `code?` (face_sdk_unavailable, model_unavailable, edge_unavailable, push_unconfigured, oidc_unconfigured), `title?`, `children?`, `action?` | explains why the capability is unavailable |
| `ConflictBanner` | `onReload`, `currentVersion`, `reloading` | text: "Updated by someone else — showing current version" |
| `NotYetImplemented` | `screenId`, `title` | rendered automatically for routes without a page |
| `PhotoUpload` | `label`, `upload(file, onProgress)`, `onUploaded`, `accept`, `maxBytes` (8 MB), `minDimension` (200), `maxMegapixels` (40) | file input + drag & drop, client precheck, preview, progress, server 422 shown inline |
| `AuthenticatedImage` | `mediaId`, `alt`, `variant?: 'thumb'`, `fallback?` | /v1/media/{id}, explicit "Image unavailable" fallback |
| `AuthenticatedVideo` | `mediaId`, `label` | explicit failure state |
| `TrendChart` | `data` (date-keyed rows), `series`, `title` | SVG grouped bars + `<details>` data table |
| `IncidentRow` | `incident` | compact row that links to the alert detail |
| `Menu` | `trigger`, `label`, `children(close)` | header popovers |
| `RouteStateBoundary`, `QueryErrorView` | see §7 | |

Status labels follow the design vocabulary: `new` is shown as "Awaiting review" (確認待ち) and camera `ready` as "Ready" (準備完了).

## 7. The four-state pattern (RouteStateBoundary)

```tsx
<RouteStateBoundary query={q} permission="dashboard.read"
  isEmpty={(d) => d.items.length === 0} empty={<EmptyState title={t('No alerts to review')} />}>
  {(data) => <Ready data={data} />}
</RouteStateBoundary>
```

The boundary checks the states in this order:

1. **Permission denied** (client-side `can(permission)`).
2. **Loading**: a skeleton, shown while there is no data yet.
3. **Error**: 403 renders PermissionDenied; 404 renders "Record not found or outside your stores"; 503 renders an `UnavailableNotice` for the code, with Retry; any other error renders `ErrorState` with Retry and the request id.
4. **Empty.**
5. **Ready.**

If a background reload fails while data is on screen, the data stays and a compact error is shown above it. `DataTable` applies the same order to lists. Detail pages also need a "no id" state (an `EmptyState` with a link back to the list); see `pages/alert-detail.tsx`.

## 8. Permissions and session

* `useSession()` returns:
  * `me`, `can(p)` and `stores`
  * `store`, the selected store, which is persisted under `rg.store` and defaults to the first store
  * `setStoreId`
  * `timeZone`, the selected store's timezone
  * `savePreferences({locale?, theme?})`
  * `signOut()`
  * `setUnread(n)`
  * `reload()`
* The sidebar hides items whose `ROUTE_META[id].permission` the user lacks. Direct navigation to such a screen renders PermissionDenied under the page header. The server enforces permissions regardless.
* Per-screen permissions are listed in `routes.meta.ts`, so change them there. `web-49` (settings) and `web-51` (notifications) are personal and have no gate; check `org.manage` inside the page for the organization-level fields.
* Theme: `light`, `dark` or `system`, set as `<html data-theme>`. It is persisted in localStorage (`rg.theme`) and on the server (`me.user.theme`, whose default is `system`); the server value wins after sign-in. `public/theme-init.js` applies it before first paint. It is an external file, so it remains compatible with a CSP of `script-src 'self'`.

## 9. Styling and responsive rules

* Use the tokens in `styles/tokens.css`: `--bg`, `--card`, `--ink`, `--muted`, `--line`, `--brand`, `--brand-ink`, `--soft`, the `--{ok,info,warning,critical,neutral}-{soft,ink}` pairs, `--radius-card` (16), `--radius-btn` (10) and the spacing scale `--s1…--s7` (4/8/12/16/24/32/48). Dark values apply under `[data-theme=dark]`, and under `[data-theme=system]` when the OS prefers dark. **Never hard-code colors in components.**
* Reusable layout classes: `.grid` (2 columns), `.grid3`, `.stats` (4 columns), `.card`, `.rows`/`.row`, `.toolbar`, `.filter`, `.form-grid` (2 columns), `.feed` (16:9 media with `.feed-label`/`.feed-time`), `.notice`, `.kv`.
* Breakpoints (also exported as `BREAKPOINTS` in `hooks/useMediaQuery.ts`):

  | Width | Name | Behavior |
  |---|---|---|
  | ≥1280 | desktop (1440 target) | sidebar 228 px, 4 stat columns, 2-column grids |
  | ≤1279 | compact (1024 target) | sidebar 196 px, tighter padding |
  | ≤1023 | drawer (768 target) | the sidebar becomes an off-canvas drawer (hamburger, overlay, Esc closes it, inert while closed); grids become 1 column; stats become 2 columns; the auth page hides its art panel |
  | ≤767 | phone (390 target) | single column; `DataTable` renders cards; toolbars stack; the page header stacks; the breadcrumb shows only the current page (hidden at ≤479) |
* Accessibility:
  * Visible focus rings come from `:focus-visible` with `--focus`.
  * There is a skip link, and `<main id="main">`.
  * The active sidebar item has `aria-current="page"`.
  * Focus moves to the h1 after navigation.
  * Touch targets are at least 44 px.
  * Status is never conveyed by color alone.
  * `prefers-reduced-motion` is respected.

## 10. Testing

```tsx
import { mockFetch, renderWithProviders, fakeSession, makeMe } from '../test/utils';
mockFetch({ 'GET /v1/incidents': { body: { items: [], next_cursor: null } },
            'POST /v1/incidents/i-1/claim': { status: 409, body: { code: 'version_conflict', message: 'x', request_id: 'r', retriable: false, current_version: 5 } } });
renderWithProviders(<Page />, { route: '/web/alert-detail?id=i-1', locale: 'ja', session: fakeSession(makeMe({ permissions: ['incident.read'] })) });
```

* Routes in `mockFetch` are matched as `"METHOD /path"`; the query string is ignored. A route can be a function to vary responses between calls. Unmatched requests return 404.
* Override the viewport media query with `installMatchMedia((q) => q === BREAKPOINTS.mobile)` from `test/setup.ts`.
* Every screen should cover: the ready state with real-shaped data, the null or unavailable states, the empty state, an error with request id, permission denied, the mutation request body (including `expected_version`), 409 handling, and Japanese rendering.

## 11. Implemented screens (exemplars)

| Screen | File | What it demonstrates |
|---|---|---|
| web-01 login | `pages/login.tsx` | uses `/v1/auth/login`, then redirects to `next`, `/web/mfa` or `/web/mfa?enroll=1`; SSO goes through `/v1/auth/config`, then either a full-page `/v1/auth/oidc/start` or an "SSO not configured" notice; generic invalid-credentials message; 429 |
| web-02 MFA | `pages/mfa.tsx` | verify with a code or a recovery code, with the trusted-device option; enrollment (`?enroll=1`) shows the QR code and secret, confirms a code, then shows the recovery codes once with an "I have saved" check |
| web-03 reset | `pages/reset.tsx` | request mode always gives the same confirmation; `?token=` switches to complete mode, with an expired-token path |
| (no id) invite | `pages/invite.tsx` | `/web/invite?token=` calls `POST /v1/auth/invitations/accept` |
| web-09 dashboard | `pages/dashboard.tsx` | null metrics shown as Unavailable; links from metrics to records; awaiting-review list; SVG trend with table fallback and the required note; camera health; live preview from `dashboard.preview` (falling back to `/v1/cameras`), or the empty state "No verified camera frame yet"; 60 s polling |
| web-19 alerts | `pages/alerts.tsx` | filters kept in the URL (channel tabs, status, priority, assignee, evidence), server-side cursor pages, delayed badge, and a statement that acknowledgement is never inferred |
| web-20 alert detail | `pages/alert-detail.tsx` | explicit evidence clip states (available, pending, unavailable, expired) with polling while pending; raw signals labelled "candidate evidence · human review required"; timeline; claim and request review with `expected_version`; ConflictBanner; Version N |
| web-53 empty | `pages/empty.tsx` | real monitoring status (analyzing camera count), last synchronized time, camera health |
| web-54 error | `pages/error.tsx` | last successful sync, last failed request; Retry re-runs a failed GET (commands are never replayed) and then checks liveness |

All other catalog routes are registered and render `NotYetImplemented` until a page is added to `routes.tsx`.
