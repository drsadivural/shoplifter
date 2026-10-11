# services/edge — validation record

Run on 2026-10-11 in the development Linux VM (not a store appliance). Everything below is
copied from real command output; nothing is summarized as passing that was not run.

## Environment

| Item | Version |
|---|---|
| OS | Linux 7.0.0-31-generic x86_64 |
| uv | 0.12.21 |
| Python | 3.12.14 (uv-managed, `uv venv --python 3.12`) |
| ffmpeg / ffprobe | 8.0.1-3ubuntu2 |
| Docker | 29.8.1 |
| mediamtx image | `bluenviron/mediamtx:latest` = `sha256:c7540465f868a02652118bea5a0daab12a29ac0f6cb8485abd535939ecddf886` |
| httpx / pynacl / pillow / jsonschema / pytest | 0.28.1 / 1.6.2 / 12.3.0 / 4.26.0 / 9.1.1 (pinned in `pyproject.toml`, locked in `uv.lock`) |

## Commands

```bash
cd services/edge
uv sync
uv run pytest -v -rs                                                        # full suite
DOCKER_HOST=unix:///nonexistent.sock uv run pytest -q -rs tests/test_rtsp_mediamtx.py   # docker-unavailable path
uvx ruff@0.14.0 check --select F,E9,B src tests                             # lint: "All checks passed!"
```

## Result

**125 passed, 0 failed, 0 skipped** (full suite, docker available). With docker unreachable the
6 RTSP tests are **skipped** (not failed): `6 skipped`.

Per file: test_agent 12, test_config_cli 6, test_discovery 5, test_gate 13, test_netpolicy 20,
test_onvif 16, test_outbox 9, test_pipeline 6, test_rtsp_mediamtx 6, test_signing 9,
test_stream 14, test_vault 5, test_watchdog 4.

What the tests exercise for real (no mocks of the thing under test):

- **Signing**: exact canonical string; Ed25519 signature verified with the public key by an
  in-test verifier on every mocked API request (heartbeat, commands, acks, events, evidence,
  snapshot); fresh nonce per retry; bounded jittered backoff; no redirect following.
- **Vault**: SealedBox round trip with the edge X25519 key, re-encryption at rest, 0600/0700
  modes, wrong-recipient rejection; password absent from repr, redacted URLs, log output and
  real ffprobe error text.
- **Subnet policy**: 169.254.169.254, 127.0.0.1, ::1, ::ffff:127.0.0.1, public IPs, other
  subnets, multicast, hostnames rejected; allowed subnet accepted; unsafe pairing CIDRs rejected.
- **ONVIF**: in-test HTTP device on the host's private IP that verifies the WS-Security
  PasswordDigest exactly (and the ONVIF guide vector `tuOSpGlFlIXsozq4HFNeeGeFLEI=`), device
  clock offset compensation, `clock_skew`, `auth_failed`, real RFC 7616 HTTP Digest fallback,
  DTD/entity rejection, `onvif_disabled`, redirect refusal, out-of-subnet/userinfo stream URI
  rejection, `unreachable`.
- **WS-Discovery**: real UDP Probe/ProbeMatch exchange (unicast to an in-test responder),
  duplicate merge, hostile DTD datagram dropped, non-permitted XAddrs removed.
- **Stream readiness**: ffmpeg-generated 640x360@15 H.264 files: 12 s → `ready`
  (h264, 640x360, 15.0 fps, ≥10 s decoded, monotonic); 3 s → `degraded`
  (`insufficient_decoded_seconds`).
- **Real RTSP** (mediamtx in docker, `-p 127.0.0.1:18554:8554` plus the private IP, RTSP auth
  enabled, ffmpeg `-re -stream_loop -1` publisher): readiness `ready` with a password that
  needs percent-encoding; wrong password → `auth_failed` (redacted); unknown path → `offline`;
  masked snapshot from the live stream; liveness monitor reaches `ready`; full agent
  `provision_camera` (sealed credential → vault → ONVIF device → GetStreamUri → real RTSP
  decode → masked snapshot upload) followed by `activate_camera` → `behavior: unavailable /
  model_not_installed`. Containers and publisher are stopped in fixture teardown.
- **Privacy mask**: pixel means inside the masked polygon < 4/255 (black), outside unchanged.
- **Gate**: all reference `GatingTests` ported, plus TTL pruning and restart persistence
  (no re-emit within cooldown after re-instantiation; partial window survives restart).
- **Outbox**: success removes item and evidence files; failed POST keeps item with backoff;
  restart keeps pending items; idempotent replay (same Idempotency-Key → one incident at the
  fake API); 422 dead-letter; tampered evidence not uploaded; raw buffers expire oldest-first;
  over-budget evidence recorded as `evidence_state: "unavailable"`.
- **Agent**: activate_camera with no models → each channel `unavailable` with
  `model_not_installed` / `face_sdk_unavailable` / `pos_unconfigured`, `analysis_state:
  "unavailable"`; gallery_update → `face_sdk_unavailable`; model_rollout → `model_not_installed`;
  forbidden provisioning targets never probed; re-delivered commands not re-executed;
  heartbeat keys ⊆ contract; run loop heartbeats, acks and flushes the outbox; CLI pair
  (against a local HTTP server) → status.

Issue found and fixed during validation: over RTSP, the first frame decoded at stream join can
carry no timestamp (reproduced in 3 consecutive full-suite runs). Leading untimed frames are
now excluded and reported as `timestamp_issues.leading_untimed`; an untimed frame after timing
is established is still `missing_timestamps` (unit-tested).

## Not verified

- Real ONVIF cameras of any vendor (Hikvision/Dahua/Axis/Uniview etc.), Media2-only devices,
  H.265 streams, RTSP over UDP, RTSPS/HTTPS cameras, NVR channel selection, fisheye, camera
  restart/credential lockout behavior. All ONVIF tests use an in-test device built from the
  ONVIF schema; the Media2 code path has no test.
- Store LAN multicast WS-Discovery (239.255.255.250:3702) across real switches/VLANs; the test
  uses unicast to an in-test responder.
- GPU inference, any behavior/pose/anomaly model, the Ayonix face SDK, POS/checkout
  integration. None are installed; all channels report `unavailable`.
- The live API (`services/api`): every API interaction was against in-test fakes that follow
  `docs/API_V1.md`; signature verification by the real server was not exercised.
- systemd unit (`deploy/retailguard-edge.service`) was not installed or started here; hardening
  directives are untested on a real appliance. `systemd-analyze verify` parsed it and reported
  only that `/opt/retailguard-edge/.venv/bin/retailguard-edge` does not exist on this VM.
- Long-running soak (memory, reconnect storms), disk-encryption, TPM-backed keys, clock skew
  of the appliance against the API (±300 s window).

## Full verbose output

```
============================= test session starts ==============================
platform linux -- Python 3.12.14, pytest-9.1.1, pluggy-1.6.0 -- /home/ubuntu/shoplifter/services/edge/.venv/bin/python
cachedir: .pytest_cache
rootdir: /home/ubuntu/shoplifter/services/edge
configfile: pyproject.toml
testpaths: tests
plugins: anyio-4.15.1
collecting ... collected 125 items

tests/test_agent.py::test_activate_camera_without_models_reports_unavailable PASSED [  0%]
tests/test_agent.py::test_activate_not_ready_camera_fails PASSED         [  1%]
tests/test_agent.py::test_gallery_update_and_model_rollout_are_honest PASSED [  2%]
tests/test_agent.py::test_pause_and_update_zones PASSED                  [  3%]
tests/test_agent.py::test_provision_forbidden_target_never_probed PASSED [  4%]
tests/test_agent.py::test_redelivered_command_not_reexecuted PASSED      [  4%]
tests/test_agent.py::test_heartbeat_matches_contract PASSED              [  5%]
tests/test_agent.py::test_provision_end_to_end_with_fake_onvif PASSED    [  6%]
tests/test_agent.py::test_provision_bad_password_reports_auth_failed PASSED [  7%]
tests/test_agent.py::test_pairing_persists_identity PASSED               [  8%]
tests/test_agent.py::test_pairing_rejects_unsafe_subnets_and_plain_http PASSED [  8%]
tests/test_agent.py::test_run_loop_heartbeats_executes_commands_and_flushes_outbox PASSED [  9%]
tests/test_config_cli.py::test_api_url_must_be_https_except_loopback PASSED [ 10%]
tests/test_config_cli.py::test_toml_and_env_precedence PASSED            [ 11%]
tests/test_config_cli.py::test_state_dir_created_0700 PASSED             [ 12%]
tests/test_config_cli.py::test_cli_pair_then_status PASSED               [ 12%]
tests/test_config_cli.py::test_cli_probe_file PASSED                     [ 13%]
tests/test_config_cli.py::test_cli_run_requires_pairing PASSED           [ 14%]
tests/test_discovery.py::test_parse_and_scopes PASSED                    [ 15%]
tests/test_discovery.py::test_dtd_payload_rejected PASSED                [ 16%]
tests/test_discovery.py::test_subnet_filtering PASSED                    [ 16%]
tests/test_discovery.py::test_real_udp_probe_exchange_dedupes_and_filters PASSED [ 17%]
tests/test_discovery.py::test_input_validation PASSED                    [ 18%]
tests/test_gate.py::test_persistent_correlated_evidence PASSED           [ 19%]
tests/test_gate.py::test_anomaly_alone_not_alert PASSED                  [ 20%]
tests/test_gate.py::test_low_visibility_not_alert PASSED                 [ 20%]
tests/test_gate.py::test_gap_resets_window PASSED                        [ 21%]
tests/test_gate.py::test_camera_isolation PASSED                         [ 22%]
tests/test_gate.py::test_out_of_order PASSED                             [ 23%]
tests/test_gate.py::test_nonfinite_score_rejected PASSED                 [ 24%]
tests/test_gate.py::test_cooldown PASSED                                 [ 24%]
tests/test_gate.py::test_track_bound PASSED                              [ 25%]
tests/test_gate.py::test_ttl_prunes_tracks PASSED                        [ 26%]
tests/test_gate.py::test_invalid_policy PASSED                           [ 27%]
tests/test_gate.py::test_restart_does_not_reemit_within_cooldown PASSED  [ 28%]
tests/test_gate.py::test_restart_preserves_partial_window PASSED         [ 28%]
tests/test_netpolicy.py::test_rejects[169.254.169.254-link_local] PASSED [ 29%]
tests/test_netpolicy.py::test_rejects[127.0.0.1-loopback] PASSED         [ 30%]
tests/test_netpolicy.py::test_rejects[::1-loopback] PASSED               [ 31%]
tests/test_netpolicy.py::test_rejects[::ffff:127.0.0.1-loopback] PASSED  [ 32%]
tests/test_netpolicy.py::test_rejects[8.8.8.8-public_address] PASSED     [ 32%]
tests/test_netpolicy.py::test_rejects[1.1.1.1-public_address] PASSED     [ 33%]
tests/test_netpolicy.py::test_rejects[192.168.11.5-outside_allowed_subnets] PASSED [ 34%]
tests/test_netpolicy.py::test_rejects[172.16.0.10-outside_allowed_subnets] PASSED [ 35%]
tests/test_netpolicy.py::test_rejects[0.0.0.0-unspecified] PASSED        [ 36%]
tests/test_netpolicy.py::test_rejects[239.255.255.250-multicast] PASSED  [ 36%]
tests/test_netpolicy.py::test_rejects[camera.local-hostname_not_allowed] PASSED [ 37%]
tests/test_netpolicy.py::test_rejects[metadata.google.internal-hostname_not_allowed] PASSED [ 38%]
tests/test_netpolicy.py::test_accepts_allowed[192.168.10.1] PASSED       [ 39%]
tests/test_netpolicy.py::test_accepts_allowed[192.168.10.254] PASSED     [ 40%]
tests/test_netpolicy.py::test_accepts_allowed[10.20.3.4] PASSED          [ 40%]
tests/test_netpolicy.py::test_accepts_allowed[::ffff:192.168.10.7] PASSED [ 41%]
tests/test_netpolicy.py::test_url_checks PASSED                          [ 42%]
tests/test_netpolicy.py::test_pairing_subnets_must_be_private PASSED     [ 43%]
tests/test_netpolicy.py::test_cidr_within PASSED                         [ 44%]
tests/test_netpolicy.py::test_empty_policy_rejects_everything PASSED     [ 44%]
tests/test_onvif.py::test_password_digest_onvif_spec_vector PASSED       [ 45%]
tests/test_onvif.py::test_full_probe_with_usernametoken_digest PASSED    [ 46%]
tests/test_onvif.py::test_mainstream_selects_largest PASSED              [ 47%]
tests/test_onvif.py::test_wrong_password_is_auth_failed PASSED           [ 48%]
tests/test_onvif.py::test_device_clock_offset_is_compensated PASSED      [ 48%]
tests/test_onvif.py::test_bad_clock_diagnosed_as_clock_skew PASSED       [ 49%]
tests/test_onvif.py::test_http_digest_fallback PASSED                    [ 50%]
tests/test_onvif.py::test_dtd_entity_response_rejected PASSED            [ 51%]
tests/test_onvif.py::test_xmlsafe_bounds PASSED                          [ 52%]
tests/test_onvif.py::test_onvif_disabled PASSED                          [ 52%]
tests/test_onvif.py::test_redirect_not_followed PASSED                   [ 53%]
tests/test_onvif.py::test_stream_uri_outside_subnet_rejected PASSED      [ 54%]
tests/test_onvif.py::test_stream_uri_with_embedded_credentials_rejected PASSED [ 55%]
tests/test_onvif.py::test_unreachable PASSED                             [ 56%]
tests/test_onvif.py::test_forbidden_device_address_rejected_before_connecting PASSED [ 56%]
tests/test_onvif.py::test_device_service_url_forms PASSED                [ 57%]
tests/test_outbox.py::test_schema_copy_matches_contract PASSED           [ 58%]
tests/test_outbox.py::test_event_id_deterministic PASSED                 [ 59%]
tests/test_outbox.py::test_invalid_event_rejected PASSED                 [ 60%]
tests/test_outbox.py::test_success_removes_item_and_uploads_evidence PASSED [ 60%]
tests/test_outbox.py::test_failed_post_keeps_item_and_survives_restart PASSED [ 61%]
tests/test_outbox.py::test_idempotent_replay PASSED                      [ 62%]
tests/test_outbox.py::test_non_retriable_rejection_dead_letters PASSED   [ 63%]
tests/test_outbox.py::test_disk_budget_expires_oldest_raw_first PASSED   [ 64%]
tests/test_outbox.py::test_tampered_evidence_not_uploaded PASSED         [ 64%]
tests/test_pipeline.py::test_no_models_installed_everything_unavailable PASSED [ 65%]
tests/test_pipeline.py::test_manifest_without_importable_runtime PASSED  [ 66%]
tests/test_pipeline.py::test_manifest_checksum_mismatch PASSED           [ 67%]
tests/test_pipeline.py::test_runtime_importable_but_no_adapter PASSED    [ 68%]
tests/test_pipeline.py::test_invalid_manifest_and_pos PASSED             [ 68%]
tests/test_pipeline.py::test_keypoint_adapter_is_explicit_stub PASSED    [ 69%]
tests/test_rtsp_mediamtx.py::test_rtsp_readiness_ready PASSED            [ 70%]
tests/test_rtsp_mediamtx.py::test_rtsp_wrong_password_is_auth_failed_and_redacted PASSED [ 71%]
tests/test_rtsp_mediamtx.py::test_rtsp_unknown_path_offline PASSED       [ 72%]
tests/test_rtsp_mediamtx.py::test_rtsp_snapshot_with_privacy_mask PASSED [ 72%]
tests/test_rtsp_mediamtx.py::test_rtsp_stream_monitor_marks_ready PASSED [ 73%]
tests/test_rtsp_mediamtx.py::test_agent_provision_end_to_end_onvif_plus_real_rtsp PASSED [ 74%]
tests/test_signing.py::test_canonical_string_exact PASSED                [ 75%]
tests/test_signing.py::test_canonical_string_empty_body_hash PASSED      [ 76%]
tests/test_signing.py::test_signature_verifies_with_public_key PASSED    [ 76%]
tests/test_signing.py::test_short_nonce_rejected PASSED                  [ 77%]
tests/test_signing.py::test_client_signs_path_with_query_and_body PASSED [ 78%]
tests/test_signing.py::test_retry_resigns_with_fresh_nonce_and_is_bounded PASSED [ 79%]
tests/test_signing.py::test_non_retriable_error_not_retried PASSED       [ 80%]
tests/test_signing.py::test_backoff_full_jitter_bounds PASSED            [ 80%]
tests/test_signing.py::test_redirects_not_followed PASSED                [ 81%]
tests/test_stream.py::test_12s_file_is_ready_with_measured_properties PASSED [ 82%]
tests/test_stream.py::test_3s_file_is_not_ready PASSED                   [ 83%]
tests/test_stream.py::test_missing_file_is_offline PASSED                [ 84%]
tests/test_stream.py::test_non_monotonic_and_codec_rules PASSED          [ 84%]
tests/test_stream.py::test_privacy_mask_blacks_out_region PASSED         [ 85%]
tests/test_stream.py::test_masked_snapshot_written_0600 PASSED           [ 86%]
tests/test_stream.py::test_apply_masks_strips_metadata PASSED            [ 87%]
tests/test_stream.py::test_invalid_zones_rejected[x] PASSED              [ 88%]
tests/test_stream.py::test_invalid_zones_rejected[zones1] PASSED         [ 88%]
tests/test_stream.py::test_invalid_zones_rejected[zones2] PASSED         [ 89%]
tests/test_stream.py::test_invalid_zones_rejected[zones3] PASSED         [ 90%]
tests/test_stream.py::test_invalid_zones_rejected[zones4] PASSED         [ 91%]
tests/test_stream.py::test_invalid_zones_rejected[zones5] PASSED         [ 92%]
tests/test_stream.py::test_stream_monitor_counts_real_frames_then_reports_end PASSED [ 92%]
tests/test_vault.py::test_sealedbox_round_trip_and_at_rest_encryption PASSED [ 93%]
tests/test_vault.py::test_wrong_recipient_and_malformed_rejected PASSED  [ 94%]
tests/test_vault.py::test_credentials_never_in_repr_or_redacted_strings PASSED [ 95%]
tests/test_vault.py::test_logging_filter_redacts_userinfo_and_passwords PASSED [ 96%]
tests/test_vault.py::test_probe_error_output_is_redacted PASSED          [ 96%]
tests/test_watchdog.py::test_state_machine_degraded_10s_offline_30s PASSED [ 97%]
tests/test_watchdog.py::test_no_frames_ever_goes_degraded_then_offline PASSED [ 98%]
tests/test_watchdog.py::test_reconnect_backoff_exponential_with_jitter_and_reset PASSED [ 99%]
tests/test_watchdog.py::test_invalid_thresholds PASSED                   [100%]

======================== 125 passed in 62.54s (0:01:02) ========================
exit=0
```

## Docker-unavailable run

```
ssssss                                                                   [100%]
=========================== short test summary info ============================
SKIPPED [1] tests/test_rtsp_mediamtx.py:117: docker/mediamtx image unavailable
SKIPPED [1] tests/test_rtsp_mediamtx.py:124: docker/mediamtx image unavailable
SKIPPED [1] tests/test_rtsp_mediamtx.py:131: docker/mediamtx image unavailable
SKIPPED [1] tests/test_rtsp_mediamtx.py:137: docker/mediamtx image unavailable
SKIPPED [1] tests/test_rtsp_mediamtx.py:148: docker/mediamtx image unavailable
SKIPPED [1] tests/test_rtsp_mediamtx.py:165: docker/mediamtx image unavailable
6 skipped in 0.14s
exit=0
```
