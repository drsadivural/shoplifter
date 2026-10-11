# Validation report

Prepared 11 October 2026.

- 25 Python workflow/domain tests passed, including persisted enrollment/photo/manual incident/search/audit, authentication, tenant isolation, simultaneous claim CAS, stale updates, path traversal denial, evidence persistence/visibility/cooldown/track isolation.
- Connected web browser E2E passed 10 flows: login, create manual incident, acknowledgement, outcome, enrollment, photo upload/display, Japanese toggle, dark mode, audit and logout. Details in WEB_REFERENCE_UI_TEST.json.
- 88 screen entries: 54 web and 34 iOS. All 352 required EN/JA × light/dark PNGs present and PNG-integrity verified. All supplied images are actual rendered designs with local fonts and synthetic imagery. Long pages include full scrolling content. Representative desktop dashboard, mobile review, enrollment and overview board visually inspected.
- JavaScript syntax and Python compilation checked. JSON contracts/catalogs parse successfully.
- Upstream Shopformer current root source availability inspected; missing described training/model source directories documented. STG-NF CC BY-NC 4.0 license documented. No unlicensed third-party models bundled.

## Not verified / not implemented in reference scope
Real ONVIF device responses on customer LAN; authenticated camera SOAP/profile setup; continuous RTSP/GPU/model inference; licensed Ayonix face SDK and template search; trained behavior checkpoint performance; biometric historical search; POS/RFID/VMS integrations; APNs on physical device; Xcode compile/sign/simulator/device; PostgreSQL migration execution; production cloud deployment/backup/restore/load. These are explicit Claude production milestones and release blockers where required.

The package is not evidence of a production-ready deployed detection service or an App Store approved build. Local tests validate reference workflow behavior, not theft detection accuracy.
