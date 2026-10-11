# Deployment and organization setup

## Organization prerequisites
Owner designates organization admin, store managers, investigators, privacy contact and responder routing. Prepare actual domains, regional hosting account, PostgreSQL, encrypted object storage, OIDC tenant, Apple Developer organization membership/App Store Connect, APNs signing credentials, Ayonix SDK license, approved model/data licensing and store camera network credentials. Configure secrets through a managed vault; do not embed them in this archive or Claude prompts.

## Environments
Local synthetic reference → development → staging with test devices → isolated store pilot → production. Separate databases, buckets, OIDC clients, certificates and APNs sandbox/production tokens. Synthetic assets never become production enrollments. Parameterize deployment domains and identifiers through environment config; reject missing production inputs at startup.

## Recommended hosting
Cloudflare serves the web frontend and manages DNS/TLS/WAF. Regional Linux hosts run the API, worker and PostgreSQL; Cloudflare Tunnel may expose the API origin with authentication and origin controls where suitable. Cloudflare R2 is an optional object store only when its available residency controls satisfy the customer policy; otherwise use regional encrypted storage. GPU inference and RTSP stay at each store appliance. Cloudflare Workers are not the store video processing runtime.

## Deployment steps
1. Create isolated staging infrastructure, private database network, encrypted volumes/bucket, secrets and restricted service identities. Apply supported OS security updates and firewall rules.
2. Build immutable web/API/worker/edge images with SBOM/license manifest, locked dependencies and vulnerabilities reviewed. No non-commercial STG-NF code in commercial images absent separate permission.
3. Provision OIDC clients with exact callback/origin allowlists and administrator MFA; enroll initial admin through a one-time workflow. API validates issuer/audience/nonce and performs server authorization.
4. Apply migrations using a migration identity. Start API as a separate restricted DB role with RLS context. Health endpoints distinguish liveness from dependency readiness; mark missing models/SDK unavailable.
5. Configure Cloudflare DNS/TLS/WAF and tunnel/origin with authenticated access. Enforce HTTPS; rate limits and request/media bounds. Deploy static web with the correct API configuration and immutable assets.
6. Install store appliance on approved camera VLAN, synchronize time, pair certificate and rotate bootstrap code. Verify outbound event channel, disk encryption, reboot persistence and diagnostics redaction.
7. Add cameras through the wizard, verify decoded frames, draw zones/masks, calibrate, and enable only validated channels. Document camera-specific coverage limits and lens/placement.
8. Configure APNs provider credentials in worker vault; build/sign iOS with real bundle ID/team and entitlements. Test physical-device notifications, expiry and logout revocation. No private key in the app.
9. Run pilot replay/live acceptance, calibrate alert budgets and retain evidence. Enable users/store scope, teach review outcomes and validate escalation.
10. Snapshot deployment/model/config versions and perform backup/restore and rollback exercises. Approve production release only with completed acceptance evidence.

## Update / rollback
Stage signed package and check license/checksum/config compatibility. Canary one store/camera, track p95 latency/false alerts/outbox age, then expand. Roll back code/model/preprocessing as one compatible unit; gallery templates require compatibility migration rather than an arbitrary model swap. Preserve incident/audit history across rollback. DB migrations are backward compatible until rollout completes.

## Backups and observability
Daily database backup plus transaction log recovery, encrypted media inventory and model manifests. Restore into isolated environment and verify tenant scope, evidence checksums and outstanding outbox. Monitor offline cameras, no fresh frames, SDK/license failures, inference delay, queue age, duplicate alerts, rejected events, pending evidence, push failures, disk pressure, certificate expiry and old unresolved cases.

## Local reference container
The included Dockerfile binds the service to loopback inside a host-network Linux container. It is for local workflow verification, not public hosting. Initialize on the host, mount the local state directory and use host networking only on Linux. Native iOS reference connects to HTTPS production-compatible endpoints; simulator local networking requires a reviewed debug-only ATS exception, not a release-wide insecure setting.

Official reference: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
