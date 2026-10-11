# Detection engineering and model integration

## Commercially practical initial pipeline
Use a commercially cleared person detector/tracker/pose estimator with Shopformer as a evaluated pose anomaly candidate, then a separately trained item-interaction corroboration model and temporal evidence rules. Use the licensed Ayonix engine for independent watchlist/staff recognition. This combination is a design recommendation; it has not been trained or validated by this archive.

Person detector choices must be evaluated for ceiling views and occlusion. An Ultralytics detector/pose model may require commercial licensing rather than assuming free closed-source redistribution. RTMPose/HRNet/YOLOX are possible alternatives subject to their actual code/weight/data licenses. Measure whole-pipeline deployment cost and recall before choosing. Tracking may use ByteTrack with explicit license verification and association tuning. Do not equate a tracker ID with a persistent identity.

## Exact tensor contract and preprocessing
1. Decode monotonically timestamped frames. Drop/reorder rules are explicit. Effective model sampling rate is fixed and recorded.
2. Produce pose keypoints with confidence and bounding boxes for each local camera track. Require minimum visible joints and relevant torso/hands where the detection type depends on them.
3. Map raw pose layout to the trained model layout. RetailS describes COCO17; Shopformer describes an 18-keypoint configuration. Read upstream code to establish neck construction, coordinate order, center normalization, confidence channels, tensor axes, segmentation length and stride. Package those actual values with each exported model; do not infer them from filenames.
4. Interpolate only short gaps below a tested limit (initial candidate 2 frames); never synthesize body motion across long occlusion. Preserve validity mask. Expire tracks after configured gaps and reset temporal state on ID switches.
5. Run reconstruction/anomaly model. Convert score to a store-calibrated rank or calibrated score using validation data. Raw anomaly scores are not probabilities of theft.
6. Independently estimate shelf-item-hand interaction where visible. An item disappearing behind a body or bag needs multi-frame contextual evidence; do not claim certainty when shelves obstruct the item.
7. Evidence gate: at least calibrated anomaly persistence plus corroborating product interaction and concealment-like trajectory; insufficient visibility yields insufficient_evidence. Actual windows/thresholds derive from local validation.
8. Emit one candidate event per camera/track/window policy with a durable key; attach score version, model/gallery versions, evidence pointers, event timestamps and uncertainty. Track dwell or browsing alone is not a supported theft event.

## Face recognition integration
Ayonix SDK must be supplied through an authorized installation and license. No invented bindings are included. Implement a vendor-documented adapter supporting initialize/shutdown, face detection, quality, alignment, template extraction, gallery update, 1:N search, license diagnostics and explicit failures. Record SDK/version/template format in the model registry. Verify whether SDK search returns similarity or distance, and threshold orientation.

Reject enrollment photos with no face, multiple faces, severe blur/occlusion or a prohibited source. Keep original photo and extracted template references separate. Reprocess templates on incompatible SDK updates through controlled migration. Match candidates require threshold and top-1/top-2 margin, multiple consistent frames, active unexpired profile and permitted store. Thresholds come from local false-match testing; do not set arbitrary “90% identity.” Staff and watchlist galleries remain distinct. Photos alone do not supply evidence of wrongdoing.

## Model lifecycle
Acquire official source at immutable revisions into a separately managed third_party location; store remote URL, commit, code/data/weight license, dependency license and checksum. Fetch datasets following official instructions. Do not include real personal footage or unlicensed model files in distribution ZIPs.

Prepare dataset manifests by store/camera/time/person and track; split before window extraction. Never allow overlapping frames/track windows across training/validation/test. Train normal-only anomaly models on reviewed normal data; anomalous examples are for validation/testing unless a specific supervised architecture is chosen. Distinguish authentic and staged theft evaluation. Retain hard negatives: staff restocking, personal shopping bags, phone use, crouching, children, accessibility aids, returning merchandise and crowded aisles.

Reproduce upstream published result, then evaluate a separate local camera holdout and unseen-store holdout. A pretrained general anomaly checkpoint is not a retail-trained checkpoint. Export ONNX only after proving identical input transformation and output equivalence against PyTorch within a stated numerical tolerance. Test CPU/GPU FP32/FP16 numerics, runtime/version, batching and queue latency. Save preprocessing manifest and checksum beside weights.

Periodic adaptation is optional and starts in shadow mode. Filter quarantined data, exclude every incident window plus buffer, sample camera/time diversity, review contamination, maintain immutable holdout, validate new model, canary one camera and auto-rollback if false-alert or latency budget worsens. Do not let an operator false-alert label immediately retrain the production model.

## Incident decision kernel
reference/domain.py implements a finite-state reference rule over already supplied signals. It validates finite scores, time order, camera/track isolation, visibility, duration, gate and dedup cooldown. It does not calculate those signals from images. Values in the example policy are starting implementation semantics only. Production must use bounded TTL state, persisted cooldown/outbox and measured tuning.

## Optional checkout / RFID / trajectory
Checkout requires a documented POS adapter, hardware lane mapping, clock-offset estimation and a calibrated visual item path. Distinguish scan, void, refund, suspend, payment, assisted checkout and missing telemetry. Time windows account for event latency and replay. A no-scan candidate must survive alternative explanation checks and be reviewed.

RFID requires item EPC mapping, reader zone confidence, dwell/exit-direction filtering, sale/deactivation events and hardware pilot. No EPC reception is not proof of concealment. Missing tags or readers make coverage unavailable. TNO-style trajectories only support context under the trained use case; circling/browsing is never sufficient by itself.

## Upstream source availability gate (verified 11 October 2026)

The official Shopformer repository's current root contains `.gitignore`, `Images`, `LICENSE`, `README.md` and `environment.yml`. The README describes model/training directories and a training entry point, but those source directories/entry points are absent from the inspected listing. Do not assume that a git clone yields runnable training/inference. Obtain the authors' complete implementation and checkpoints under documented rights, or independently implement the published architecture and label results as an independent reproduction until protocol equivalence is verified. This is an external prerequisite for the proposed Shopformer route.

A practical alternate production route is a commercially cleared supervised temporal pose + item-interaction model trained on rights-cleared store clips, evaluated against the same held-out event metrics. Its architecture, weights and results must be built and validated; no claimed ready weights are supplied. STG-NF remains a research baseline unless separately licensed. Model selection is a milestone decision based on rights, source availability and local measured performance, not solely paper ranking.
