# End-to-end: edge appliance ↔ API ↔ real RTSP stream

Date: 2026-10-11 (JST). Host: Linux x86_64 cloud VM (no GPU, no physical cameras, no store LAN).

## Setup (actual)
- API: `services/api` at commit-under-test, `python -m retailguard_api serve` on 127.0.0.1:8710, PostgreSQL 17 (dev DB with production roles/RLS).
- Edge: `services/edge` `retailguard-edge pair` then `retailguard-edge run` (heartbeat 5 s, command poll 2 s).
- Camera stand-in: `bluenviron/mediamtx` container (own IP 172.17.0.4, RTSP :554) fed by
  `ffmpeg -re -stream_loop -1` with a 640×360 15 fps H.264 testsrc file. No ONVIF service (generic RTSP).

## Results
| Step | Observed |
|---|---|
| Pairing code (console) → `retailguard-edge pair` | Paired; edge received store binding and allowed subnets |
| Signed heartbeats | Edge `online`, software 0.1.0, clock_offset_ms 995 (1 s resolution from HTTP Date) |
| First provisioning attempt at host IP 10.3.0.16 | **Correctly refused**: ONVIF probe of http://10.3.0.16/ hit Caddy's HTTP→HTTPS redirect; edge rejected the redirect (`redirect_rejected` → `target_not_permitted`), camera `offline` |
| Provisioning at 172.17.0.4 with rtsp_path /cam1 | ONVIF unreachable → configured RTSP fallback; decoded 13.333 s; h264 640×360 15 fps; monotonic timestamps; `conformance: unverified_generic_rtsp`; readiness `ready` |
| Snapshot | Privacy-masked JPEG uploaded; `last_frame_at` advancing |
| Activate behavior + watchlist | Console shows `activation_requested`, then edge ack → `analysis_state: unavailable`, behavior `model_not_installed`, watchlist `face_sdk_unavailable` (no fake "analyzing") |
| Discovery job (interface 10.3.0.16, 3 s) | Real WS-Discovery multicast probe executed on the edge; `completed` with 0 devices (no ONVIF devices on this VM network) |

## Not verified here
Real ONVIF cameras (SOAP auth/profiles against vendor firmware), store LAN multicast, H.265, GPU inference,
face SDK, behavior models, POS hardware, APNs delivery, iOS on device.
