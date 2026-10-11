# Research and competitor feature transfer

Reviewed 11 October 2026. Product marketing describes capabilities, not independent evaluation. No competitor proprietary code or model is bundled.

| Source | Verified useful pattern | RetailGuard requirement |
|---|---|---|
| Dragonfruit shoplifting alarm | Combining pose/object/behavior, configurable alerts, review clips, camera/zone timelines and multi-camera investigation | Independent signal explanations, store/zone thresholds, evidence clips, candidate visit association, cases |
| 3DiVi theft detection | Enrolled repeat-offender face matching, store-network lists, immediate alerts and existing CCTV integration | Licensed Ayonix SDK, reviewed enrollment, tenant/store scope, expiry, separate watchlist alert type |
| Veesion solution | Local server + mobile app, gesture selection by store/camera, outcome qualification, roles and measured ROI | Edge appliance, configurable personal-bag/backpack rules, responder app, review feedback and real impact dashboard |
| NCR StopLift / ScanItAll | Published acquisition establishes checkout-focused computer-vision loss prevention; detailed deployed interfaces are not public here | Separate POS/visual reconciliation connector and validation pilot; do not claim a ScanItAll API exists |
| RADAR | Integrated RFID item localization/analytics platform | Optional tagged-item connector. It is a vendor hardware platform, not a downloadable theft algorithm |
| TNO pickpocket study | Tracking features used for early suspicious-behavior recognition in a shopping mall | Optional trajectory research; do not treat pickpocket features as a proven shelf-theft detector |

The proposed combination is our engineering recommendation. It does not assert that competitors share these models or SDKs. “Pilot Veesion” means optionally evaluate licensed vendor performance alongside RetailGuard in an agreed store; it does not grant access to Veesion weights or permit copying its algorithms.

## Algorithm comparison
| Candidate | Evidence / availability | Decision |
|---|---|---|
| Shopformer on PoseLift | Official paper/repo reports AUC-ROC 69.15, AUC-PR 44.49, EER 0.38; repo marked Apache-2.0 | First reproducibility/evaluation candidate, not plug-and-play commercial accuracy |
| STG-NF on PoseLift | Official Shopformer comparison lists AUC-ROC 67.46, AUC-PR 84.06, EER 0.39 | Useful research baseline. AUC-PR differences need protocol verification |
| STG-NF with RetailS periodic adaptation | RetailS supplies multi-camera pose data, filtering/collection/training process and real/staged evaluation | Test drift adaptation offline after rights are cleared; frozen holdout and rollback required |
| TNO track-based pickpocket | Research paper; different behavior/setting | Lower priority contextual features only |
| StopLift/NCR ScanItAll | Commercial checkout technology | Partner/vendor pilot or implement an independently developed POS correlation module |
| RADAR RFID + CV | Proprietary integrated retail platform | Optional partner integration dependent on documented hardware/API |
| Veesion | Commercial gesture alerting system | Optional benchmark procurement, not bundled code |

**Critical metric interpretation:** 69.15 versus 67.46 is a 1.69 percentage-point AUC-ROC difference, about 2.5% relative. It is not a 67.46% improvement. AUC-ROC is threshold-independent discrimination, not “69.15% of thefts caught.” The source narrative contains confusing wording; use its table values and reproduce the protocol. Report AUC-PR with positive prevalence, score orientation, labels and aggregation units. Do not average different metric families into “accuracy.”

## Primary references
- Dragonfruit: https://dragonfruit.ai/apps/shoplifting-alarm/
- 3DiVi: https://3divi.ai/shoplifting-detection
- Veesion: https://veesion.io/en/our-solution/
- NCR: https://www.ncrvoyix.com/ja/newsroom/stoplift1107 (dated 2018; not evidence of current standalone availability)
- RADAR: https://goradar.com/
- Shopformer paper: https://arxiv.org/abs/2504.19970
- Shopformer official repo: https://github.com/TeCSAR-UNCC/Shopformer
- PoseLift official repo: https://github.com/TeCSAR-UNCC/PoseLift
- RetailS official repo: https://github.com/TeCSAR-UNCC/RetailS
- STG-NF official repo: https://github.com/orhir/STG-NF
- STG-NF license: https://github.com/orhir/STG-NF/blob/main/LICENSE
- TNO: https://repository.tno.nl/SingleDoc?find=UID+347d5692-bdf2-4cd0-9a5c-d10566ae1c3b

No unverified marketplace promises, competitor accuracy numbers or ROI percentages are used as product acceptance criteria.

## Upstream source availability gate (verified 11 October 2026)

The official Shopformer repository's current root contains `.gitignore`, `Images`, `LICENSE`, `README.md` and `environment.yml`. The README describes model/training directories and a training entry point, but those source directories/entry points are absent from the inspected listing. Do not assume that a git clone yields runnable training/inference. Obtain the authors' complete implementation and checkpoints under documented rights, or independently implement the published architecture and label results as an independent reproduction until protocol equivalence is verified. This is an external prerequisite for the proposed Shopformer route.

A practical alternate production route is a commercially cleared supervised temporal pose + item-interaction model trained on rights-cleared store clips, evaluated against the same held-out event metrics. Its architecture, weights and results must be built and validated; no claimed ready weights are supplied. STG-NF remains a research baseline unless separately licensed. Model selection is a milestone decision based on rights, source availability and local measured performance, not solely paper ranking.
