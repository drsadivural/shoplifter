# Store operations / 店舗運用

## Staff response
An alert means review is needed. Open the clip, check the timestamp/camera and observed behavior, acknowledge only if taking responsibility, and record facts. Distinguish confirmed incident, false alert and inconclusive. If footage is insufficient, choose inconclusive and request review. Follow the retailer's trained response procedure; the software does not direct confrontation or establish legal authority.

「通知を受けたら、まず映像・時刻・カメラ位置を確認してください。AIの結果だけで決めつけず、確認できた事実を記録します。対応する担当者が『対応開始』を選び、事案として確認・誤通知・判断保留のいずれかを理由付きで記録してください。判断できない場合は、店長または調査担当者へ確認を依頼します。」

## Daily administrator checks
Check camera frame freshness/analysis health, edge connectivity, disk/spool, open alerts and notification delivery errors. Review false alerts by camera/gesture; change thresholds only with version/reason and validation. Check profiles expiring soon and pending approvals. Verify staff departures deactivate staff records and app sessions separately.

## Incident/evidence handling
Keep original evidence; comments are separate. Link related incidents with uncertainty. Export only authorized scope with purpose/recipient and audit. Use protected internal channels; do not publish watchlist images or suspect names. Correct erroneous enrollment promptly and propagate gallery removal to edge. Keep retention consistent across backups/indexes/media.

## Outage procedures
Camera offline: verify power/network/credential/ONVIF/stream; preserve pending incident evidence and report coverage gap. Edge offline: local analysis may continue but remote push/live view may fail; use store fallback procedure and check spool on reconnect. APNs failure: use web/mobile inbox, revoke stale tokens and monitor outbox. Model unavailable: suspend that channel, repair license/model/config and validate before reactivation.

## Diagnostic bundle
Collect versions, redacted health/errors, clock offsets, queue timings and anonymized configuration. Exclude face templates, camera passwords, refresh/APNs tokens and private photos by default. Store-specific evidence inclusion requires authorized scope/purpose and expiring access.
