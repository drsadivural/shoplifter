# RetailGuard edge appliance (`services/edge`)

Store-local service for Ayonix RetailGuard. It pairs with the regional API, discovers and
provisions ONVIF/RTSP cameras on the store's camera subnet, verifies stream readiness by
decoding real frames, uploads privacy-masked snapshots, reports honest health, and keeps a
durable outbox for candidate events and evidence.

**What it does not do.** No detection model, face SDK or POS integration ships here. Every
analysis channel (`behavior`, `watchlist`, `checkout`) reports `unavailable` with a reason
(`model_not_installed`, `face_sdk_unavailable`, `pos_unconfigured`) until a licensed,
validated integration is installed (see "Analysis channels" below). Activating a camera
without one acks `analysis_state: "unavailable"`. The edge never produces synthetic scores
or detections.

The wire contract is `docs/API_V1.md` → "Edge-authenticated API".

## Layout

| Module | Purpose |
|---|---|
| `config.py` | TOML + env config; state dir created `0700`; API must be `https://` (http only for loopback tests) |
| `identity.py` | Ed25519 signing key + X25519 box key (`0600`), `pair()` → `POST /v1/edge/pair` |
| `client.py` | Signed httpx client (`X-Edge-Id/Timestamp/Nonce/Signature`), bounded retries with jittered backoff, no redirects |
| `vault.py` | Opens `credential_sealed` (SealedBox), stores re-encrypted (SecretBox, local `0600` key) per camera |
| `redact.py` | URL/secret redaction and a logging filter |
| `netpolicy.py` | Allowed-subnet enforcement for every camera/ONVIF/RTSP target |
| `xmlsafe.py` | DTD/entity rejection, size and depth bounds for untrusted XML |
| `discovery.py` | WS-Discovery Probe (port of `edge/discover.py`), dedupe, subnet filtering; without an interface the probe goes out of every private IPv4 interface |
| `usb.py` | USB (V4L2) camera listing from sysfs, preferring stable `/dev/v4l/by-id/...` links |
| `onvif.py` | ONVIF Device/Media/Media2 SOAP client, UsernameToken digest + HTTP digest fallback |
| `stream.py` | ffprobe readiness probe (RTSP, USB/V4L2 or file), ffmpeg snapshot, privacy masks (Pillow) |
| `watchdog.py` | Per-camera health state machine and ffmpeg liveness monitor |
| `pipeline.py` | Channel adapter interface + availability registry |
| `gate.py` | Evidence gate (port of `reference/domain.py`) with SQLite-persisted cooldown |
| `outbox.py` | Durable SQLite outbox, idempotent replay, disk budget |
| `agent.py` | Heartbeat, command polling/execution/acks, run loop |
| `__main__.py` | CLI: `pair`, `run`, `discover`, `status`, `probe` |

## Requirements

- Linux appliance on the store camera VLAN (or with an interface on it), Python 3.12,
  `ffmpeg`/`ffprobe` (tested with 8.0.1), outbound HTTPS to the API.
- Python dependencies are pinned in `pyproject.toml` and locked in `uv.lock`
  (httpx, pynacl, pillow, jsonschema; pytest for development).

## Install

```bash
sudo apt-get install -y ffmpeg
sudo useradd --system --home /var/lib/retailguard-edge --shell /usr/sbin/nologin retailguard-edge
sudo mkdir -p /opt/retailguard-edge /etc/retailguard-edge
sudo cp -r services/edge/* /opt/retailguard-edge/
cd /opt/retailguard-edge
# Install the interpreter under /opt so the hardened unit (ProtectHome=yes) can reach it.
sudo env UV_PYTHON_INSTALL_DIR=/opt/retailguard-edge/python uv python install 3.12
sudo env UV_PYTHON_INSTALL_DIR=/opt/retailguard-edge/python uv sync --frozen --no-dev
sudo cp deploy/config.example.toml /etc/retailguard-edge/config.toml   # edit api_base_url, interface
sudo chown root:retailguard-edge /etc/retailguard-edge/config.toml && sudo chmod 0640 /etc/retailguard-edge/config.toml
sudo cp deploy/retailguard-edge.service /etc/systemd/system/
```

## Pair

An org/store admin creates a one-time code (`POST /v1/stores/{id}/edge-pairing-codes`,
single use, 15 min). On the appliance:

```bash
sudo -u retailguard-edge /opt/retailguard-edge/.venv/bin/retailguard-edge \
  --state-dir /var/lib/retailguard-edge pair --api https://retailguard.example.com --code ABCD-1234 --name "Shibuya edge 1"
```

This generates the keys (never leave the appliance), sends the public keys, and stores
`edge_id`, `org_id`, `store_id` and `allowed_subnets` in `edge.json` (`0600`). The printed
`fingerprint` (SHA-256 of the Ed25519 public key) can be compared with the API's edge record.
Re-pairing requires deliberately removing `edge.json` (the old edge should be revoked in the
console first). The pairing code is not logged or stored.

## Run

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now retailguard-edge
journalctl -u retailguard-edge -f
sudo -u retailguard-edge /opt/retailguard-edge/.venv/bin/retailguard-edge --state-dir /var/lib/retailguard-edge status
```

The loop sends `POST /v1/edge/heartbeat` every 15 s (software version, clock offset from the
API `Date` header, disk free/total, spool pending/age, per-camera readiness/analysis state/
channels/fps/resolution/codec, installed models), polls `GET /v1/edge/commands` every 5 s,
executes `discover`, `provision_camera`, `activate_camera`, `pause_camera`, `update_zones`,
`model_rollout`, `gallery_update`, and acks each with `POST /v1/edge/commands/{id}/ack`.
Processed command IDs are recorded, so a re-delivered command is re-acked, not re-executed.

Camera sources (`provision_camera.source_type`):

- `onvif` (default): ONVIF device service at the address; the stream URI comes from the Media service.
- `rtsp`: a URL the operator entered (`rtsp_scheme`, `rtsp_port`, `rtsp_path`); no ONVIF negotiation.
  The target is still checked against the allowed subnets; credentials arrive sealed.
- `usb`: a V4L2 device on the appliance (`address` = `/dev/v4l/by-id/...` or `/dev/videoN`). ffmpeg reads
  it with `-f v4l2`; MJPEG and raw YUV are accepted in addition to H.264/H.265. A USB camera can be
  opened by one process at a time, so do not run other capture software on it. The systemd unit allows
  only `char-video4linux` devices and adds the `video` group. `discover` lists USB cameras when the
  API asks for them (`include_usb`).

Other commands:

```bash
retailguard-edge discover --timeout 5                               # WS-Discovery from every private interface
retailguard-edge discover --interface 192.168.10.2 --timeout 5      # ... or from one interface only
retailguard-edge probe --source rtsp://192.168.10.21:554/Streaming/Channels/102 --username viewer
                                                                     # password from RETAILGUARD_EDGE_PROBE_PASSWORD or prompt
retailguard-edge probe --source /path/to/sample.mp4                  # file diagnostics
```

## Provisioning flow (`provision_camera`)

1. `address` (IP, `IP:port`, or device-service URL) must be inside `allowed_subnets`;
   loopback, link-local (incl. `169.254.169.254`), multicast, public addresses and hostnames
   are always rejected (`target_not_permitted`).
2. `credential_sealed` is opened with the box key and re-encrypted into the vault.
3. ONVIF: `GetSystemDateAndTime` (unauthenticated; measures device clock offset),
   `GetDeviceInformation`, `GetCapabilities` (or `GetServices` → Media/Media2),
   `GetProfiles`, `GetStreamUri`, `GetSnapshotUri`. Every XAddr/URI is re-validated against the
   subnets; redirects are refused; XML with DTD/entities, oversize or over-deep is rejected.
   Distinct failures: `auth_failed`, `clock_skew`, `onvif_disabled`, `unreachable`,
   `target_not_permitted`.
4. If ONVIF is disabled/unreachable and `rtsp_path` was supplied, a generic
   `rtsp://<address>:554<rtsp_path>` is tried and the report says
   `conformance: "unverified_generic_rtsp"`.
5. Readiness: ffprobe decodes a bounded sample (10 s + 4 s keyframe grace). `ready` only with
   ≥10 s of decoded frames, monotonic timestamps, H.264/H.265 and known resolution; otherwise
   `degraded` (some frames) or `offline` (none), with error codes.
6. One frame is grabbed in memory, privacy masks (zones of type `privacy_mask`) are filled
   black, and the JPEG is uploaded with `PUT /v1/edge/cameras/{id}/snapshot`.

The ack is `succeeded` only when readiness is `ready`; otherwise `failed` with the first
error code, and the full `{readiness, report}` in `result`.

## Analysis channels

`pipeline.ChannelRegistry` marks a channel available only if a manifest file is configured,
its artifact SHA-256 matches, its declared `runtime` module is importable, and its declared
`adapter` (`module:Class`, supplied by the integrator) implements `ChannelAdapter`. The
manifest format is documented in `pipeline.py`. Checkout additionally needs a POS integration
config. The COCO-17 → model keypoint mapping is intentionally a `NotImplementedError` stub:
it must come from the upstream model's preprocessing contract (docs/ALGORITHMS.md).

`gallery_update` acks `failed` / `face_sdk_unavailable` until a licensed Ayonix integration
provides an adapter with a gallery method. `model_rollout` reports whether the named model is
installed locally; the edge never downloads or fabricates model files.

## Security notes

- Keys, vault key, vault and pairing state are `0600` in a `0700` state dir.
- Credentials are injected into the RTSP URL only in the ffmpeg/ffprobe argv (argument list,
  no shell) and redacted from all errors and logs. The unit uses `ProtectProc=invisible` so
  other users cannot read the child's command line.
- HTTPS to cameras does not verify certificates (cameras ship self-signed certs); the target
  is pinned to the allowed subnets instead.
- Event spool: evidence under `spool/evidence` with SHA-256 recorded at enqueue and verified
  before upload. Raw ring buffers (`spool/raw`) expire oldest-first under the disk budget;
  pending evidence is never deleted to make room — new evidence is refused and the event is
  marked `evidence_state: "unavailable"`.
- Disk encryption (LUKS/TPM) is an appliance-image responsibility and is not configured here.

## Troubleshooting

| Symptom | Likely cause / action |
|---|---|
| `discover` finds nothing | WS-Discovery is multicast (239.255.255.250:3702, TTL 1): it does not cross routed VLANs. Use an interface on the camera VLAN, an IT-approved relay, or add cameras by address. Check that ONVIF discovery is enabled on the camera and that host firewalls allow UDP 3702 replies. |
| Devices listed with empty `xaddrs` | The camera advertised XAddrs outside `allowed_subnets`; they were dropped (`xaddrs_rejected`). Fix the camera network config or the store's allowed subnets in the console. |
| `target_not_permitted` | Address/URI outside `allowed_subnets`, a hostname, link-local/loopback/public, a redirect, or a URI with embedded credentials. |
| `auth_failed` | Wrong user/password, or account locked on the camera. Use a read-only ONVIF user. Repeated attempts may trigger camera lockout. |
| `clock_skew` | Camera clock differs >120 s and authentication failed with and without compensation. Configure NTP on the camera. |
| `onvif_disabled` | ONVIF service off or not at `/onvif/device_service`. Enable ONVIF, or supply `rtsp_path` for a generic RTSP (unverified) stream. |
| `insufficient_decoded_seconds` / `degraded` | Stream connects but frames stop; check bitrate/network, substream settings, keyframe interval. |
| `non_monotonic_timestamps` / `missing_timestamps` | Camera/NVR time stamping problem; see `timestamp_issues` in the report. |
| API 401 in logs | Edge revoked, or appliance clock outside ±300 s. Check `timedatectl`; re-pair if revoked. |
| Spool growing | API unreachable; events replay idempotently on reconnect. `status` shows pending/dead counts. |

Network: the appliance only makes outbound connections (HTTPS to the API, HTTP/RTSP to cameras
on allowed subnets). No inbound ports are required.

## Development

```bash
cd services/edge
uv sync
uv run pytest -q            # RTSP tests need docker + bluenviron/mediamtx:latest, else skipped
```

See `VALIDATION.md` for the latest recorded run and what has not been verified.
