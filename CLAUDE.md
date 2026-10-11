# Repository instructions for Claude Code

Read README, CLAUDE_CODE_JOB, docs/PRODUCT, docs/ARCHITECTURE, docs/IMPLEMENTATION, docs/ALGORITHMS, docs/SECURITY, docs/ONVIF, docs/SCREEN_SPEC and docs/ACCEPTANCE before modifying source.

Use the screen IDs, routes, required fields and tokens in design/ as the UI acceptance contract. All user-facing text must exist in Japanese and English. Japanese browser preferences default to Japanese; otherwise English, with explicit preference retained. Native iOS uses preferred languages and an in-app override.

No invented performance metrics, fictitious model integration, disabled buttons, empty handlers, arbitrary similarity probabilities, randomly generated detections or competitor code copied without rights. Synthetic designs are not runtime business records. Preserve explicit unavailability when a model/SDK/connector is absent. Never mark a camera analyzing solely because its record exists.

Build functional vertical slices. Persist all commands, enforce org/store scope, validate payloads, use optimistic concurrency, and emit auditable changes. Browser, iOS and edge clients must use the same contracts. No face templates, credentials, evidence URLs or sensitive photos in logs/APNs payloads.

Watchlist match is not proof of wrongdoing. Behavioral suspicion is not identity. Staff recognition annotates permitted workflow context; it does not exempt staff from independently supported checkout exceptions. Human reviewers select confirmed / false alert / inconclusive and provide reasons. Enrollment requires evidence basis, review, scope and expiry; no enrollment merely from an anomaly alert.

Use official model repositories at pinned revisions, record license for code/data/weights, reproduce published baselines and validate local generalization. STG-NF upstream code is CC BY-NC 4.0 and must not enter a commercial artifact without separately obtained permission. Do not treat Shopformer/PoseLift repository licenses as blanket clearance of every weight or data source.

Protect tests from training contamination. Do not continuously retrain from every operator label. Use reviewed datasets, frozen holdout, canary deployment and rollback. Model outputs must fail closed to unavailable, not zero risk or a fake successful detection.

Run meaningful tests after each milestone, fix failures at their cause, and retain real output in validation reports. Do not claim iOS simulator build or device push tests from this Linux environment. Build/simulator/device checks belong on a Mac or a macOS CI runner.

Do not deploy publicly or submit to Apple without a concrete reviewed release and credentials supplied through secure configuration. User instructions may separately authorize deployment. Work on local implementation and reviewable outputs autonomously.
