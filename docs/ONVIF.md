# ONVIF discovery, stream onboarding and automatic activation

## Where discovery runs
Run edge/discover.py on the store appliance. WS-Discovery uses multicast UDP 239.255.255.250:3702. Multicast is typically scoped to the local subnet; routed/VLAN stores require a local agent on each permitted segment, explicit discovery relay agreed with IT, or manual addresses. Never scan arbitrary external ranges from a cloud API.

The included utility performs real Probe/ProbeMatch discovery only. Full authenticated ONVIF provisioning/RTSP inference is specified below for Claude implementation; the utility does not claim those capabilities.

## Camera wizard
1. Choose store and paired edge; require camera-admin access.
2. Pick permitted local interface, scan timeout and allowed CIDR. Send bounded WS-Discovery probes. Deduplicate by endpoint UUID / serial where known. Display vendor/model/address and discovery time.
3. Authenticate with read-only camera credentials through edge credential vault. Support standards-compliant UsernameToken digest and device-supported HTTP authentication. Never put RTSP passwords in browser URLs, API responses or logs. Diagnose bad clock, invalid user and disabled ONVIF distinctly.
4. Query GetDeviceInformation, GetCapabilities/GetServices and Media/Media2 GetProfiles. Select a supported profile; get RTSP stream URI and snapshot URI. Support Profile T H.264/H.265 where verified; handle device-specific features accurately. Mark conformance unverified if only a generic RTSP stream works.
5. Check the URI target against approved camera subnet before connecting; reject redirects to metadata/internal control services. Bound SOAP XML size/depth and disable entity expansion. Discovery-provided XAddr is untrusted input.
6. Open substream, decode a minimum 10-second sample and verify monotonic time, codec, resolution, FPS, rotation, lens distortion and visibility. Camera handshake success without decoded frames is not readiness.
7. Run a placement check: view of product interaction, hands/torso visible, adequate pixel size, lighting and crowd occlusion. Face matching may be unavailable on an overhead aisle camera even if behavior analysis is available; entry camera is often the separate face candidate source. Store camera-specific coverage warnings.
8. Draw shelf/checkout/exit/privacy masks in normalized [0,1] coordinates. Configure detection policy and local hours. Bind POS lanes when available. Validate polygons and motion direction; record settings version.
9. Activate approved channels. Start decoding/inference automatically after a committed activation command and acknowledge real health. Missing license/model/profile prevents that channel from starting. Do not merely set a database boolean.
10. Health watchdog: degraded after missing frames threshold (initial 10s), offline after sustained failure (initial 30s), reconnect backoff with jitter, bounded queues, credential lockout protection and health event. Validate those limits with actual devices.

## Required compatibility coverage
Hikvision/Dahua/Axis/Uniview or customer fleet samples; ONVIF enabled/disabled; digest/password mistakes; IPv4 multi-NIC; VLAN isolation; dynamic IP change; duplicate endpoint; Media/Media2 profiles; H.264/H.265; RTSP TCP/UDP; camera restart; corrupt frames; stale timestamp; fisheye; NVR channel selection; main/substream difference; cloud-only cameras without RTSP. Do not promise universal camera compatibility without testing.

## Network security
Separate camera VLAN and managed appliance. Appliance initiates outbound mTLS HTTPS for event/config exchange. No public camera ports or inbound exposure. Least-privilege credentials; encryption on disk using OS TPM/keystore where available. Pairing codes single-use/short-lived, bound to intended store. Certificate revocation and replay rejection are mandatory. Discovery itself does not authenticate a device; provisioning does.

## Official sources
https://www.onvif.org/profiles/profile-t/
https://www.onvif.org/profiles/specifications/
https://learn.microsoft.com/en-us/windows-hardware/drivers/stream/network-cameras
