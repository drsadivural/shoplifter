# Complete screen implementation specification

Normal presentations are included as individual PNGs for every screen in EN/JA and light/dark. Each screen also requires loading, empty, error and permission-denied implementation states. Some screen kinds share a component; their fields, actions and authorization remain screen specific.

## web-01 — Sign in / ログイン

Platform: web. Route: `/web/login`. Visual class: auth.

Fields/content: Work email, Password, Continue with company SSO, Remember this device.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-01-login.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-02 — Verify your identity / 本人確認

Platform: web. Route: `/web/mfa`. Visual class: auth.

Fields/content: Authentication code, Recovery code, Trusted device, Verify.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-02-mfa.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-03 — Reset password / パスワード再設定

Platform: web. Route: `/web/reset`. Visual class: auth.

Fields/content: Work email, Send reset link, New password, Confirm password.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-03-reset.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-04 — Organization setup / 組織の初期設定

Platform: web. Route: `/web/organization`. Visual class: form.

Fields/content: Organization name, Default timezone, Data region, Primary administrator.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-04-organization.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-05 — Stores & regions / 店舗・エリア管理

Platform: web. Route: `/web/stores`. Visual class: table.

Fields/content: Store, Region, Cameras, Health, Open alerts.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-05-stores.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-06 — Tokyo flagship / 東京旗艦店

Platform: web. Route: `/web/store-detail`. Visual class: dashboard.

Fields/content: Coverage, Camera health, Open incidents, Review queue.

Required behavior: Aggregate current authorized data/health/queue; real last refresh; unavailable sources distinct from zero; link metrics to filtered records.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-06-store-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-07 — Add a store / 店舗を追加

Platform: web. Route: `/web/store-add`. Visual class: form.

Fields/content: Store name, Address, Timezone, Store manager, Opening hours.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-07-store-add.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-08 — Connect edge appliance / エッジ端末を接続

Platform: web. Route: `/web/edge-pair`. Visual class: form.

Fields/content: Pairing code, Store, Device name, Certificate fingerprint, Pair device.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-08-edge-pair.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-09 — Loss prevention overview / ロス防止ダッシュボード

Platform: web. Route: `/web/dashboard`. Visual class: dashboard.

Fields/content: Open alerts, Reviewed incidents, Online cameras, Median acknowledgement.

Required behavior: Aggregate current authorized data/health/queue; real last refresh; unavailable sources distinct from zero; link metrics to filtered records.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-09-dashboard.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-10 — Live camera wall / ライブカメラ

Platform: web. Route: `/web/live`. Visual class: wall.

Fields/content: Entrance, Cosmetics aisle, Grocery aisle, Checkout lane.

Required behavior: Show authorized live streams with health/frame freshness/privacy masks; no exposed RTSP credentials; adapt columns to viewport.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-10-live.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-11 — Discover ONVIF cameras / ONVIFカメラを検索

Platform: web. Route: `/web/camera-discovery`. Visual class: discovery.

Fields/content: Network interface, Scan timeout, Device, IP address, ONVIF profile.

Required behavior: Start edge-local bounded scan; show actual discovered devices; authenticate/profile/readiness before activation; explain multicast/VLAN limitations.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-11-camera-discovery.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-12 — Add camera manually / カメラを手動追加

Platform: web. Route: `/web/camera-add`. Visual class: form.

Fields/content: Camera name, Device address, Username, Password, Store, Stream profile.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-12-camera-add.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-13 — Bulk camera import / カメラを一括登録

Platform: web. Route: `/web/camera-import`. Visual class: form.

Fields/content: CSV file, Credential group, Store, Validate rows, Import valid devices.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-13-camera-import.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-14 — Camera inventory / カメラ一覧

Platform: web. Route: `/web/cameras`. Visual class: table.

Fields/content: Camera, Store, Stream status, Analysis status, Last frame.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-14-cameras.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-15 — Camera readiness / カメラ接続・画角確認

Platform: web. Route: `/web/camera-detail`. Visual class: video.

Fields/content: Live preview, Resolution, Frame rate, Pose visibility, Start analysis.

Required behavior: Authorized playable stream/clip with timestamps, health/availability, seeking and URL renewal; unavailable/expired clearly handled.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-15-camera-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-16 — Detection zone editor / 検知エリアの設定

Platform: web. Route: `/web/zones`. Visual class: zones.

Fields/content: Shelf zone, Checkout zone, Exit line, Privacy mask, Save zones.

Required behavior: Draw/edit normalized polygons and directional exit lines over actual view; validate geometry and masks; persist version and edge acknowledgement.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-16-zones.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-17 — Behavior detection rules / 行動検知ルール

Platform: web. Route: `/web/detection-rules`. Visual class: settings.

Fields/content: Clothing concealment, Backpack gesture, Personal bag gesture, Shelf interaction, Minimum evidence.

Required behavior: Persist typed settings with version, scope and audit; explain dependencies; unauthorized controls hidden and server rejected.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-17-detection-rules.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-18 — Store calibration / 店舗ごとの調整

Platform: web. Route: `/web/calibration`. Visual class: chart.

Fields/content: False alerts per camera-hour, Reviewed precision, Recall sample, Threshold, Publish calibration.

Required behavior: Use measured reviewed outcomes and defined denominators; filter by store/time; show sample count and coverage, no invented accuracy or savings.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-18-calibration.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-19 — Alert inbox / アラート一覧

Platform: web. Route: `/web/alerts`. Visual class: alerts.

Fields/content: Behavior, Watchlist, Checkout, Priority, Assignee.

Required behavior: Live/paginated scoped inbox with type, evidence state, priority, assignee and delay; acknowledgement never inferred from push delivery.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-19-alerts.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-20 — Review an alert / アラートを確認

Platform: web. Route: `/web/alert-detail`. Visual class: review.

Fields/content: Evidence clip, Trigger signals, Camera timeline, Acknowledge, Request review.

Required behavior: Fetch evidence and current version; permit scoped claim/escalation/review; confirm facts only through human outcome; retain timestamps and uncertainty.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-20-alert-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-21 — Record incident outcome / 確認結果を記録

Platform: web. Route: `/web/alert-outcome`. Visual class: form.

Fields/content: Outcome, Reason, Observed behavior, Loss value, Supporting evidence.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-21-alert-outcome.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-22 — Escalation policy / 通知・エスカレーション

Platform: web. Route: `/web/alert-escalation`. Visual class: settings.

Fields/content: Primary responders, Acknowledgement deadline, Backup responders, Quiet hours, Push privacy.

Required behavior: Persist typed settings with version, scope and audit; explain dependencies; unauthorized controls hidden and server rejected.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-22-alert-escalation.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-23 — Incident register / 事案記録

Platform: web. Route: `/web/incidents`. Visual class: table.

Fields/content: Incident, Store, Status, Outcome, Evidence, Reviewer.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-23-incidents.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-24 — Incident workspace / 事案の詳細

Platform: web. Route: `/web/incident-detail`. Visual class: review.

Fields/content: Evidence, Notes, Related visits, Review history, Create case.

Required behavior: Fetch evidence and current version; permit scoped claim/escalation/review; confirm facts only through human outcome; retain timestamps and uncertainty.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-24-incident-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-25 — Case management / 案件管理

Platform: web. Route: `/web/cases`. Visual class: table.

Fields/content: Case, Owner, Incidents, Status, Last updated.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-25-cases.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-26 — Case investigation / 案件調査

Platform: web. Route: `/web/case-detail`. Visual class: review.

Fields/content: Linked incidents, Timeline, Evidence manifest, Access log, Close case.

Required behavior: Fetch evidence and current version; permit scoped claim/escalation/review; confirm facts only through human outcome; retain timestamps and uncertainty.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-26-case-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-27 — Enrolled watchlist / 登録対象者

Platform: web. Route: `/web/watchlist`. Visual class: people.

Fields/content: Profile, Reference photos, Review status, Store scope, Expiry.

Required behavior: Paginated scoped profiles with approved photos, status/expiry and authorized detail/add actions; no public enumeration.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-27-watchlist.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-28 — Enroll a subject / 対象者を登録

Platform: web. Route: `/web/watchlist-enroll`. Visual class: enroll.

Fields/content: Reference ID, Supporting incident, Enrollment reason, Store scope, Review date, Reference photos.

Required behavior: Record evidence/provenance, scope, expiry and photos; run quality/template extraction; require approval; do not auto-enroll from an unreviewed detection.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-28-watchlist-enroll.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-29 — Watchlist profile / 登録対象者の詳細

Platform: web. Route: `/web/watchlist-detail`. Visual class: profile.

Fields/content: Approved photos, Visit history, Linked incidents, Match candidates, Suspend profile.

Required behavior: Show authorized photos, scope, evidence basis, status and candidate visits; correction/suspension/deletion audited and propagated to galleries.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-29-watchlist-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-30 — Enrollment approval / 登録内容の承認

Platform: web. Route: `/web/watchlist-approval`. Visual class: review.

Fields/content: Evidence basis, Photo quality, Scope, Expiry, Approve enrollment.

Required behavior: Fetch evidence and current version; permit scoped claim/escalation/review; confirm facts only through human outcome; retain timestamps and uncertainty.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-30-watchlist-approval.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-31 — Staff directory / スタッフ一覧

Platform: web. Route: `/web/staff`. Visual class: people.

Fields/content: Employee, Store, Photos, Status, Enrollment date.

Required behavior: Paginated scoped profiles with approved photos, status/expiry and authorized detail/add actions; no public enumeration.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-31-staff.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-32 — Enroll staff / スタッフを登録

Platform: web. Route: `/web/staff-enroll`. Visual class: enroll.

Fields/content: Employee ID, Display name, Store assignment, Role, Photo notice, Reference photos.

Required behavior: Record evidence/provenance, scope, expiry and photos; run quality/template extraction; require approval; do not auto-enroll from an unreviewed detection.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-32-staff-enroll.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-33 — Staff profile / スタッフ情報

Platform: web. Route: `/web/staff-detail`. Visual class: profile.

Fields/content: Reference photos, Assigned stores, Match history, Detection policy, Deactivate.

Required behavior: Show authorized photos, scope, evidence basis, status and candidate visits; correction/suspension/deletion audited and propagated to galleries.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-33-staff-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-34 — Photo library / 写真ライブラリ

Platform: web. Route: `/web/photos`. Visual class: photos.

Fields/content: Profile type, Upload date, Quality, Approved, Rejected.

Required behavior: Authorized original/thumbnail, quality/provenance/status; delete by policy; reject invalid payload/face quality; no unscoped signed URL.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-34-photos.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-35 — Historical search / 過去記録の検索

Platform: web. Route: `/web/search`. Visual class: search.

Fields/content: Date range, Store, Camera, Event type, Outcome, Reference photo.

Required behavior: Execute scoped date/camera/type/outcome query; optional quality-checked temporary photo; report available coverage/retention, not fabricated hits.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-35-search.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-36 — Search results / 検索結果

Platform: web. Route: `/web/search-results`. Visual class: results.

Fields/content: Timeline, Candidate similarity, Store, Camera, Evidence availability.

Required behavior: Rank authorized candidates with quality/time/source; similarity not probability; open evidence; reviewer accepts/rejects association.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-36-search-results.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-37 — Visit reconstruction / 来店履歴の確認

Platform: web. Route: `/web/visit-detail`. Visual class: review.

Fields/content: Entry, Camera transitions, Candidate associations, Exit, Review uncertainty.

Required behavior: Fetch evidence and current version; permit scoped claim/escalation/review; confirm facts only through human outcome; retain timestamps and uncertainty.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-37-visit-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-38 — Checkout exceptions / レジ例外検知

Platform: web. Route: `/web/checkout`. Visual class: table.

Fields/content: Lane, Transaction, Visual interaction, Scan timestamp, Exception.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-38-checkout.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-39 — Transaction reconciliation / 取引・映像の照合

Platform: web. Route: `/web/checkout-detail`. Visual class: checkout.

Fields/content: Video timeline, POS event, Barcode, Item count, Clock offset.

Required behavior: Align lane video with POS scan/void/payment timestamps and clock offsets; missing telemetry unavailable; create review candidates only.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-39-checkout-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-40 — POS, RFID & VMS / POS・RFID・VMS連携

Platform: web. Route: `/web/integrations`. Visual class: settings.

Fields/content: POS connector, RFID reader, VMS connector, Signed webhook, Last heartbeat.

Required behavior: Persist typed settings with version, scope and audit; explain dependencies; unauthorized controls hidden and server rejected.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-40-integrations.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-41 — Reports & measured impact / レポート・効果測定

Platform: web. Route: `/web/reports`. Visual class: chart.

Fields/content: Reviewed precision, False alerts, Acknowledgement time, Confirmed loss, Recovered value.

Required behavior: Use measured reviewed outcomes and defined denominators; filter by store/time; show sample count and coverage, no invented accuracy or savings.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-41-reports.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-42 — Export evidence / 証拠をエクスポート

Platform: web. Route: `/web/report-export`. Visual class: form.

Fields/content: Case scope, Redaction, Export reason, Recipient, Expiry, Generate evidence bundle.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-42-report-export.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-43 — User management / ユーザー管理

Platform: web. Route: `/web/users`. Visual class: table.

Fields/content: User, Role, Store scope, MFA, Last sign-in.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-43-users.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-44 — Invite a teammate / ユーザーを招待

Platform: web. Route: `/web/user-invite`. Visual class: form.

Fields/content: Email, Role, Stores, Invitation expiry, Send invite.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-44-user-invite.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-45 — Roles & permissions / 権限管理

Platform: web. Route: `/web/roles`. Visual class: permissions.

Fields/content: Viewer, Responder, Investigator, Store admin, Organization admin.

Required behavior: Enforce server actions per role/store; prevent privilege escalation and self-lockout; changes audited and sessions refreshed.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-45-roles.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-46 — Events & audit log / イベント・監査ログ

Platform: web. Route: `/web/logs`. Visual class: table.

Fields/content: Time, Actor, Action, Resource, Store, Result.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-46-logs.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-47 — System health / システム稼働状況

Platform: web. Route: `/web/health`. Visual class: dashboard.

Fields/content: Edge connectivity, Decode latency, GPU utilization, Queue age, Storage.

Required behavior: Aggregate current authorized data/health/queue; real last refresh; unavailable sources distinct from zero; link metrics to filtered records.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-47-health.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-48 — Model registry / モデル管理

Platform: web. Route: `/web/models`. Visual class: table.

Fields/content: Model, Version, License status, Validation, Rollout, Rollback.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-48-models.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-49 — Organization settings / 組織設定

Platform: web. Route: `/web/settings`. Visual class: settings.

Fields/content: Display language, Appearance, Timezone, Session timeout, Retention.

Required behavior: Persist typed settings with version, scope and audit; explain dependencies; unauthorized controls hidden and server rejected.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-49-settings.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-50 — Retention & privacy / 保存・個人情報設定

Platform: web. Route: `/web/privacy`. Visual class: settings.

Fields/content: Raw video retention, Evidence retention, Profile expiry, Legal hold, Deletion requests.

Required behavior: Persist typed settings with version, scope and audit; explain dependencies; unauthorized controls hidden and server rejected.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-50-privacy.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-51 — Notification settings / 通知設定

Platform: web. Route: `/web/notifications`. Visual class: settings.

Fields/content: Behavior alerts, Watchlist alerts, Checkout alerts, Sound, Store routing.

Required behavior: Persist typed settings with version, scope and audit; explain dependencies; unauthorized controls hidden and server rejected.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-51-notifications.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-52 — Support & diagnostics / サポート・診断

Platform: web. Route: `/web/support`. Visual class: form.

Fields/content: Issue category, Affected store, Diagnostics consent, Description, Generate diagnostic bundle.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-52-support.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-53 — No alerts to review / 未確認アラートはありません

Platform: web. Route: `/web/empty`. Visual class: empty.

Fields/content: Monitoring active, Last synchronized, Camera health, View history.

Required behavior: Show true zero-result state and monitoring/coverage status; link history/setup; no synthetic business data.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-53-empty.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## web-54 — Connection interrupted / 接続が中断されました

Platform: web. Route: `/web/error`. Visual class: error.

Fields/content: Last successful sync, Local monitoring, Retry, Diagnostics.

Required behavior: Show last successful sync and safe recovery; disable stale conflicting mutations; preserve drafts securely and refresh after reconnection.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/web/en/light/web-54-error.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-01 — Welcome to RetailGuard / RetailGuardへようこそ

Platform: ios. Route: `/ios/welcome`. Visual class: auth.

Fields/content: Company workspace, Secure store response, English / 日本語, Continue.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-01-welcome.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-02 — Sign in / ログイン

Platform: ios. Route: `/ios/login`. Visual class: auth.

Fields/content: Work email, Password, Company SSO, Sign in.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-02-login.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-03 — Verify sign-in / ログインを確認

Platform: ios. Route: `/ios/mfa`. Visual class: auth.

Fields/content: Authentication code, Recovery code, Verify.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-03-mfa.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-04 — Enable Face ID / Face IDを有効にする

Platform: ios. Route: `/ios/faceid`. Visual class: auth.

Fields/content: Unlock securely, Device-only biometrics, Enable Face ID, Later.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-04-faceid.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-05 — Enable notifications / 通知を有効にする

Platform: ios. Route: `/ios/permission`. Visual class: auth.

Fields/content: Incident alerts, Private lock-screen text, Enable notifications, Later.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-05-permission.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-06 — Select stores / 店舗を選択

Platform: ios. Route: `/ios/stores`. Visual class: table.

Fields/content: Tokyo flagship, Yokohama branch, Osaka branch, Assigned access only.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-06-stores.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-07 — Store overview / 店舗ダッシュボード

Platform: ios. Route: `/ios/home`. Visual class: dashboard.

Fields/content: Open alerts, Online cameras, My assignments, Today’s reviewed incidents.

Required behavior: Aggregate current authorized data/health/queue; real last refresh; unavailable sources distinct from zero; link metrics to filtered records.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-07-home.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-08 — Live alerts / 最新アラート

Platform: ios. Route: `/ios/alerts`. Visual class: alerts.

Fields/content: Behavior, Watchlist, Checkout, Assigned to me.

Required behavior: Live/paginated scoped inbox with type, evidence state, priority, assignee and delay; acknowledgement never inferred from push delivery.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-08-alerts.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-09 — Review alert / アラート確認

Platform: ios. Route: `/ios/alert-detail`. Visual class: review.

Fields/content: Evidence clip, Camera, Signal, Acknowledge, Review outcome.

Required behavior: Fetch evidence and current version; permit scoped claim/escalation/review; confirm facts only through human outcome; retain timestamps and uncertainty.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-09-alert-detail.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-10 — Evidence player / 証拠動画

Platform: ios. Route: `/ios/clip`. Visual class: video.

Fields/content: Before trigger, Trigger marker, After trigger, Playback speed, Full screen.

Required behavior: Authorized playable stream/clip with timestamps, health/availability, seeking and URL renewal; unavailable/expired clearly handled.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-10-clip.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-11 — Take ownership / 対応を開始

Platform: ios. Route: `/ios/acknowledge`. Visual class: form.

Fields/content: Assigned responder, Current version, Acknowledge, Escalate.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-11-acknowledge.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-12 — Record outcome / 結果を記録

Platform: ios. Route: `/ios/outcome`. Visual class: form.

Fields/content: Confirmed incident, False alert, Inconclusive, Reason, Loss value.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-12-outcome.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-13 — Request assistance / 応援を依頼

Platform: ios. Route: `/ios/escalate`. Visual class: form.

Fields/content: Assigned team, Priority, Reason, Notify backup.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-13-escalate.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-14 — Incident details / 事案詳細

Platform: ios. Route: `/ios/incident`. Visual class: review.

Fields/content: Evidence, Outcome, Notes, History, Related visits.

Required behavior: Fetch evidence and current version; permit scoped claim/escalation/review; confirm facts only through human outcome; retain timestamps and uncertainty.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-14-incident.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-15 — Past records / 過去の記録

Platform: ios. Route: `/ios/history`. Visual class: table.

Fields/content: Date, Store, Event type, Outcome, Reviewer.

Required behavior: Paginated scoped persistent records, server sorting/filtering and authorized detail/actions; stable ordering; loading/empty/denied tested.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-15-history.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-16 — Search records / 記録を検索

Platform: ios. Route: `/ios/search`. Visual class: search.

Fields/content: Date range, Store, Type, Reference photo, Search.

Required behavior: Execute scoped date/camera/type/outcome query; optional quality-checked temporary photo; report available coverage/retention, not fabricated hits.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-16-search.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-17 — Search results / 検索結果

Platform: ios. Route: `/ios/results`. Visual class: results.

Fields/content: Candidate thumbnail, Time, Camera, Similarity rank, Open evidence.

Required behavior: Rank authorized candidates with quality/time/source; similarity not probability; open evidence; reviewer accepts/rejects association.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-17-results.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-18 — Watchlist / 登録対象者

Platform: ios. Route: `/ios/watchlist`. Visual class: people.

Fields/content: Approved profiles, Photo, Expiry, Assigned stores.

Required behavior: Paginated scoped profiles with approved photos, status/expiry and authorized detail/add actions; no public enumeration.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-18-watchlist.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-19 — Subject profile / 対象者プロフィール

Platform: ios. Route: `/ios/profile`. Visual class: profile.

Fields/content: Reference photos, Evidence basis, Scope, Visit candidates.

Required behavior: Show authorized photos, scope, evidence basis, status and candidate visits; correction/suspension/deletion audited and propagated to galleries.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-19-profile.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-20 — Enroll subject / 対象者を登録

Platform: ios. Route: `/ios/subject-enroll`. Visual class: enroll.

Fields/content: Reference ID, Incident, Reason, Scope, Expiry, Photos.

Required behavior: Record evidence/provenance, scope, expiry and photos; run quality/template extraction; require approval; do not auto-enroll from an unreviewed detection.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-20-subject-enroll.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-21 — Staff / スタッフ

Platform: ios. Route: `/ios/staff`. Visual class: people.

Fields/content: Employee, Photo, Store, Enrollment status.

Required behavior: Paginated scoped profiles with approved photos, status/expiry and authorized detail/add actions; no public enumeration.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-21-staff.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-22 — Enroll staff / スタッフを登録

Platform: ios. Route: `/ios/staff-enroll`. Visual class: enroll.

Fields/content: Employee ID, Name, Store, Notice recorded, Photos.

Required behavior: Record evidence/provenance, scope, expiry and photos; run quality/template extraction; require approval; do not auto-enroll from an unreviewed detection.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-22-staff-enroll.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-23 — Capture reference photo / 登録写真を撮影

Platform: ios. Route: `/ios/photo-capture`. Visual class: capture.

Fields/content: Face fully visible, Neutral pose, Good lighting, Retake, Use photo.

Required behavior: Use system permission flow and real camera; frame guidance; quality validation; retake/upload with progress and offline error; no photo auto-approval.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-23-photo-capture.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-24 — Review photo quality / 写真品質を確認

Platform: ios. Route: `/ios/photo-quality`. Visual class: photos.

Fields/content: Face count, Sharpness, Exposure, Pose, Approve photo.

Required behavior: Authorized original/thumbnail, quality/provenance/status; delete by policy; reject invalid payload/face quality; no unscoped signed URL.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-24-photo-quality.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-25 — Visit timeline / 来店タイムライン

Platform: ios. Route: `/ios/visits`. Visual class: review.

Fields/content: Entrance, Aisle, Checkout, Exit, Association uncertainty.

Required behavior: Fetch evidence and current version; permit scoped claim/escalation/review; confirm facts only through human outcome; retain timestamps and uncertainty.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-25-visits.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-26 — Cameras / カメラ

Platform: ios. Route: `/ios/cameras`. Visual class: wall.

Fields/content: Entrance, Aisle, Checkout, Online status.

Required behavior: Show authorized live streams with health/frame freshness/privacy masks; no exposed RTSP credentials; adapt columns to viewport.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-26-cameras.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-27 — Camera preview / カメラ映像

Platform: ios. Route: `/ios/camera`. Visual class: video.

Fields/content: Authorized live view, Connection status, Last frame, Privacy mask.

Required behavior: Authorized playable stream/clip with timestamps, health/availability, seeking and URL renewal; unavailable/expired clearly handled.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-27-camera.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-28 — Notification preferences / 通知の設定

Platform: ios. Route: `/ios/notifications`. Visual class: settings.

Fields/content: Stores, Types, Sound, Quiet hours, Private preview.

Required behavior: Persist typed settings with version, scope and audit; explain dependencies; unauthorized controls hidden and server rejected.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-28-notifications.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-29 — Account & security / アカウント・セキュリティ

Platform: ios. Route: `/ios/account`. Visual class: settings.

Fields/content: Face ID, Active sessions, Language, Appearance, Sign out.

Required behavior: Persist typed settings with version, scope and audit; explain dependencies; unauthorized controls hidden and server rejected.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-29-account.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-30 — Response team / 対応チーム

Platform: ios. Route: `/ios/team`. Visual class: people.

Fields/content: On duty, Store manager, Responder, Contact via approved channel.

Required behavior: Paginated scoped profiles with approved photos, status/expiry and authorized detail/add actions; no public enumeration.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-30-team.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-31 — Offline mode / オフライン

Platform: ios. Route: `/ios/offline`. Visual class: error.

Fields/content: Last synced, Pending draft, Reconnect, Refresh before submission.

Required behavior: Show last successful sync and safe recovery; disable stale conflicting mutations; preserve drafts securely and refresh after reconnection.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-31-offline.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-32 — All caught up / 確認が完了しました

Platform: ios. Route: `/ios/empty`. Visual class: empty.

Fields/content: No pending alerts, Monitoring status, View past records.

Required behavior: Show true zero-result state and monitoring/coverage status; link history/setup; no synthetic business data.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-32-empty.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-33 — Session expired / セッションが切れました

Platform: ios. Route: `/ios/session-expired`. Visual class: auth.

Fields/content: Sign in again, Unsaved draft, Company SSO.

Required behavior: Validate authentication inputs; never expose whether an email exists; establish/recover only authorized sessions. Support expired/error/denied paths.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-33-session-expired.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.

## ios-34 — Help & diagnostics / ヘルプ・診断

Platform: ios. Route: `/ios/help`. Visual class: form.

Fields/content: Camera issue, Notification issue, Contact support, Diagnostics.

Required behavior: Validate every required field before persistence; show inline errors; save atomically; record actor and version; preserve draft on retry without duplicate commands.

Acceptance: all listed fields translated; applicable primary controls functional; tenant/store restrictions enforced; data survives refresh; related command has audit; layout matches `mockups/ios/en/light/ios-34-help.png`; dark/JA variants covered. No clipping at target size; long-content pages scroll with controls reachable.
