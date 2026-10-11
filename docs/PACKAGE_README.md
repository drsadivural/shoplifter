# Ayonix RetailGuard — Claude Code implementation package

Prepared 11 October 2026 (Japan). Japanese / English. Web console + native iOS responder + store edge video analytics.

## Start here
1. Open `START_HERE.md` and paste `CLAUDE_CODE_JOB.md` into Claude Code.
2. Browse `design/index.html` through the local server, or inspect PNGs in `mockups/` without any server.
3. Run the included reference service to exercise enrollment, photos, historical search and alert review.
4. Implement the production milestones in `docs/IMPLEMENTATION.md`; do not call the reference service a finished commercial product.

## What is delivered
- Complete screen catalog and editable HTML/CSS designs; every catalog screen rendered individually in EN/JA × light/dark.
- Separate web and iOS PNG files, annotated screen requirements and image index.
- Detailed Claude Code job, architecture, data model, API contracts, threat model, ONVIF/RTSP onboarding, algorithms, SDK integration, training and evaluation, deployment, operating procedures and App Store handoff.
- Runnable, dependency-free Python local reference API and functional web workbench: authentication, persisted camera records, staff/watchlist profiles, photo upload, incident creation, review state transitions, search and audit.
- Executable WS-Discovery utility for a real local ONVIF network and deterministic evidence-gating engine, with meaningful tests.
- Native SwiftUI source for real API login, incident list/detail/outcome, profile enrollment, photo upload and historical record search; XcodeGen project configuration.
- Repository structure, environment configuration, CI, local container build and production database specification.

## Delivery boundary
This is an implementation and design package for Claude Code, with runnable reference components. It is **not** a deployed, validated theft detector or an App Store approved application. The inspected Shopformer upstream also lacks its described model/training source files. No licensed Ayonix SDK, customer footage, trained retail checkpoints, APNs keys or Apple signing identity are bundled. These are explicit integration inputs, not fabricated assets. The reference components do not claim to recognize faces or detect theft from raw video. A record added in the workbench is a manually entered record, not an AI detection.

All demonstration photos and metrics are synthetic. Similarity, pose anomalies, watchlist candidates and checkout exceptions are distinct signals; an alert never establishes that a crime occurred.

## Local reference run
```bash
python3 reference/server.py init
python3 reference/server.py serve
```
The initializer prints a generated administrator password once. It creates no default public credentials. Open http://127.0.0.1:8788/workbench/ and sign in with the printed account. The design catalog is at http://127.0.0.1:8788/design/.

```bash
python3 -m unittest discover -s tests -v
python3 edge/discover.py --interface 192.168.10.2 --timeout 5
```
The interface address must belong to the machine running discovery. Run discovery on the store LAN, not in a cloud service. Multicast does not automatically cross VLANs.

## Folders
```text
Ayonix_RetailGuard_Package/
  START_HERE.md
  CLAUDE.md
  CLAUDE_CODE_JOB.md
  docs/                Product, engineering, ML, security, release instructions
  design/              Editable screen catalog and UI design system
  mockups/web/         Individual web PNGs: language/theme/screen
  mockups/ios/         Individual iOS PNGs: language/theme/screen
  assets/              Synthetic store views and fictional portraits
  reference/           Runnable local API, domain rules and web workbench
  ios/                 SwiftUI connected reference client and project config
  edge/                Real ONVIF WS-Discovery utility
  contracts/           JSON contracts and production SQL schema
  deployment/          Reference container and production runbooks
  tests/               Workflow and evidence-gating checks
  scripts/             Design rendering and archive verification
  .github/workflows/   Reference validation CI
```

The reference server binds only to loopback. Production uses enterprise OIDC, PostgreSQL row-level isolation, encrypted object storage, a supported API framework and hardened edge services. See `docs/SECURITY.md` and `docs/DEPLOYMENT.md`.
