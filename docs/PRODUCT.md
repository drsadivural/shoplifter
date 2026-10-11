# Product requirements

## Users and scope
Organization admin manages regional stores, policies, users and licenses. Store admin owns camera placement, local calibration and evidence-backed enrollment. Responder receives/claims/reviews alerts at assigned stores. Investigator searches authorized records, links cases and exports approved evidence. Viewer has limited redacted views. Staff enrollment does not automatically create a login account; staff and app users are different entities.

## Detection channels
1. **Behavior:** observed product handling / concealment-like gesture; identity not required. Show reason, evidence and uncertainty.
2. **Watchlist:** candidate match against approved, scoped, unexpired profiles; independent of any behavior alert. A reviewer decides whether the person matches.
3. **Checkout:** a visual item transfer inconsistent with synchronized POS scan/payment activity. “Not observed” is distinct from “not paid”; missing POS telemetry yields unavailable.
4. **RFID:** observed tagged-item movement, checked against authoritative sale/deactivation state and zone confidence. Tags near exits are not necessarily departing.
5. **Staff context:** recognized enrolled staff with active scope; annotate work context without silently suppressing staff-related losses.

Enrollment covers staff and subjects associated with reviewed incidents. Use internal reference IDs rather than speculative names. Reference photos, evidence basis, authorization, scope, approval, expiration, correction and suspension are mandatory. No public/shared cross-retailer list is included by default. Cross-store use is explicitly scoped inside one authorized organization.

## Core journey
Admin creates organization/store → installs edge → pairs certificate → discovers ONVIF cameras → authenticates → inspects live profile → configures zones/readiness → enables analysis. Successful activation starts the configured pipelines automatically; dependencies missing, bad view or no real frames leave a visible pending/degraded state.

An edge candidate becomes an incident only after the configured evidence gate. Pre/post trigger clip and best frame are captured, a durable event is ingested, push is sent and the inbox updates. A responder claims the current version, reviews, records confirmed / false_alert / inconclusive with reason, and optionally requests investigation. Enrollment remains a separate approval flow.

Search retrieves retained records with dates, store, camera, event type, outcome, person profile and optional query photo. Query photos have short temporary lifetimes. Matches are candidates. Historical search must never imply coverage for periods before camera activation, after outages or beyond retention. Case linking preserves original evidence and records associations separately.

## Language and UI
Web defaults to Japanese when preferred languages include Japanese, otherwise English. Do not infer locale solely from IP. Persist the explicit user choice. iOS follows preferred language plus override. All dates convert to store timezone, while audit storage uses UTC. Currency is explicit, initially JPY. Labels: 要確認 (review required), 登録対象者 (enrolled subject), 行動検知 (behavior signal), 判断保留 (inconclusive).

Use the supplied teal/navy/light/dark design, precise table controls, responsive camera previews and native iOS structure. Dashboard, logs/events, users and settings are first-class modules. No consumer-facing criminality labels generated from AI.

## Initial operating assumptions
One organization may operate multiple stores. Start with one-store pilot, 4–8 approved cameras and a single edge GPU; capacity is a measured deployment constraint, not a promised count. 15fps analysis is a starting profile; train/infer at the same effective sampling rate. Evidence ring buffer design default: 10s pre + 20s post. Privacy masks persist. Profile and evidence retention are configurable, reviewed by store policy. Commercial hosting defaults to Cloudflare front door with regional API/database/ML infrastructure.
