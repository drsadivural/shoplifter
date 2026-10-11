# Enrollment, photos and historical records

## Watchlist enrollment lifecycle
Draft → pending_review → approved → suspended/expired → deleted. Only evidence-reviewed records can become approved. Record profile reference ID, purpose, incident link, evidence basis, requested store scope, approval authority, creation/review/expiry and version. “Known shoplifter” in business terminology must not become an automatic criminality label from a model candidate.

A reviewer approves with current version. Source incident must exist in permitted scope and contain a human-reviewed outcome/evidence. Photos must have provenance and permissible purpose. Changes to evidence/photos/scope reset approval when material; inactive or expired profiles immediately leave gallery queries. Gallery update is transactional with revision tracking and edge acknowledgement. A deleted profile's templates are removed from all galleries, caches and spool indexes; evidence records preserve only policy-authorized references/holds.

Staff enrollment is separate: employee ID, preferred display name, assigned stores, role/context policy, photo notice/provenance, validity and deactivation. Staff recognition may annotate restocking/authorized activity but does not blanket-exempt staff from checkout review. Do not expose staff reference photographs broadly to all viewers.

## Photo pipeline
Accept JPEG/PNG with bounded byte and pixel dimensions, inspect actual bytes, strip EXIF/location, transcode safely, check face count/quality using the licensed SDK, generate thumbnail, retain encrypted original if policy requires it and extract templates. Each photo has immutable checksum/provenance/status. Failed extraction does not silently approve enrollment. Multiple photos may improve pose coverage but must be from the same verified subject; duplicates are not new evidence.

Reference workbench uploads validate magic/size but do not implement SDK face quality or EXIF stripping. Keep them local and use synthetic data only. Production adds full decode/transcode/quality scanning. Never migrate local reference uploads automatically into a production gallery.

## Search
Metadata filters: organization/store, camera, captured date range, event channel, current outcome, assignee, profile reference, case and evidence availability. Paginated stable ordering on capture_time + id, authorized store scope before query. Search only retained indexed data. Empty result may reflect missing coverage; show cameras/outage/retention hints.

Photo search: temporary authenticated upload → quality/embedding extraction → gallery/retained-face index within permitted scope → top candidates with raw rank, time, source camera and quality → reviewer confirms association or rejects. Short query-photo TTL (initial 1h); no auto-enrollment. Template versions must match; unknown SDK/embedding format is not comparable. Approximate nearest neighbors followed by exact reranking and scope filtering. Do not use visual lookalikes to assign guilt.

Visit associations use local track boundaries, adjacent camera topology and time plausibility. Across stores or days, require separate authorized identity evidence. Re-ID confidence is labeled uncertain and may be wrong; preserve rejected links. Historical person search may be disabled when face retention is not authorized.

## Evidence and exports
Preserve capture timestamps, camera/profile/config/model/gallery revisions, video checksum, generation chain and actor audit. Redact unrelated shoppers in exports where required. Export creates a manifest with hashes and access expiry, records recipient/purpose and audits download. Expiration/deletion affects objects, database links, caches and indexes. Holds require reason/owner/review date; they are not an indefinite default.

## Reference vs production
The runnable service includes metadata/text search only. Photo-based biometric search, track associations, quality and gallery matching are production implementation work requiring SDK/models. The design screens and contracts specify them fully; they are never simulated by fabricated reference scores.
