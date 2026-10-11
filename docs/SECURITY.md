# Security and Japanese operating controls

## Production controls
Use enterprise OIDC, MFA for sensitive roles, short access sessions, rotating refresh tokens, revocation and audited session management. Browser cookies Secure/HttpOnly/SameSite with CSRF defenses; mobile secrets in Keychain, device-only access class. Administrator bootstrap is one-time and password reset is audited. The local reference password authentication is not the production identity service.

Every API endpoint authorizes tenant, store and action. Restrict object store access similarly; unguessable IDs are not authorization. RLS and foreign keys prevent cross-tenant references. Test cross-store investigators, revoked users, deleted profiles, late APNs taps and expired exports. Avoid embedding organization roles in unsigned client requests.

Encrypted edge disk and media/templates; distinct keys and roles; KMS envelope encryption and rotation; backups included in retention/restore design. No credentials/templates/evidence content in telemetry. Redact URLs and query payloads. Signed edge events use authenticated certificates, timestamps, nonce/idempotency keys and replay windows. Restrict provisioning destinations and validate discovered XAddr/RTSP endpoints to approved store subnets.

Ingress limits, JSON/schema validation, image byte+pixel limits, safe transcoding, malware scanning when applicable and background export isolation. API 4xx/5xx responses expose no stack or SDK licensing secrets. Workers run least-privilege; dependency SBOM and known-vulnerability scans run before release. Audit entries include actor/action/resource/store/time/result/request ID; write to immutable archive or hash chain with independently protected root for stronger tamper evidence.

## Risk-to-control mapping
| Failure | Control | Verification |
|---|---|---|
| False behavioral accusation | Signal language, evidence review, inconclusive option | Ambiguous footage review test |
| Incorrect face association | Quality, threshold/margin, multiple frames, candidate review | Lookalike/low-quality test |
| Unauthorized enrollment | Evidence basis, scoped approval, expiry/correction | Invalid source and role tests |
| Employee exemption abused | Staff annotation without blanket suppression | Checkout exception for recognized staff |
| Cross-tenant access | API scope, RLS, object authorization | Negative authorization suite |
| Camera SSRF | Subnet allowlist, URL scheme/port checks, no arbitrary redirect | Forbidden target test |
| Push leakage | Generic message+opaque incident ID | Lock-screen/device audit |
| Alert lost on outage | Atomic outbox and durable edge spool | Offline/restart replay test |
| Concurrent conflicting review | Expected version CAS | Two-device race |
| Model drift | Frozen holdout, shadow/canary, rollback | Camera change/lighting regression |

## Japan-first data handling
PPC guidance says identifiable camera images and face-feature data require appropriate handling and a sufficiently specific purpose; use of face identification must be clearly reflected in the stated purpose. Define a store notice and access/correction/deletion process before operational enrollment. Cross-retailer sharing requires a separately assessed purpose/legal arrangement and is disabled in this product by default. This section is implementation guidance, not a conclusion that a particular customer's processing is lawful.

Suggested Japanese notice for customer review:
「当店では、防犯および事案の確認のため、防犯カメラ映像と顔識別機能を利用しています。登録情報は定められた目的・対象範囲・保存期間に従って管理します。お問い合わせは店舗管理責任者までお申し出ください。」

Publish actual operator/contact, specific use, storage duration, rights procedure and authorized sharing scope. Avoid using loss-prevention biometric data for marketing by default. Separate optional face matching from non-biometric behavior mode. Do not claim that pose features are automatically anonymous under every law; linkage to retained identities can remain identifying.

Primary sources:
https://www.ppc.go.jp/news/camera_related/
https://www.ppc.go.jp/personalinfo/faq/APPI_QA/

## Local reference limitations
Loopback-only HTTP, PBKDF2 password hashes, expiring bearer sessions, optimistic state transitions, tenant predicates and bounded uploads are included. It lacks enterprise OIDC/MFA, rate limiting suitable for the internet, object-store encryption, SDK quality, full role administration and signed edge ingestion. Serve synthetic test data only; no public exposure. Production migration replaces these shortcuts rather than claiming they are hardened enough.
