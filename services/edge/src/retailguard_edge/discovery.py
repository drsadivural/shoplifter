"""WS-Discovery Probe for ONVIF NetworkVideoTransmitters (port of edge/discover.py).

Discovery only: a ProbeMatch does not authenticate a device. Responses are
untrusted: DTD/entity payloads are rejected, size/depth are bounded, results
are deduplicated by endpoint reference and filtered to the allowed subnets
(both the responder's source address and each advertised XAddr).

Multicast (239.255.255.250:3702) is link-local in practice: it does not cross
routed VLANs unless IT provides a relay. Cameras on other segments must be
added by address.

Without an explicit interface the probe goes out of every private IPv4 interface of the
appliance (one socket, one window), so operators do not need to know the appliance's address.
"""
from __future__ import annotations

import ipaddress
import socket
import time
import uuid
from typing import Any
from urllib.parse import unquote, urlsplit

from .netpolicy import SubnetPolicy, TargetNotPermitted
from .xmlsafe import UnsafeXML, find_local, findall_local, local, safe_fromstring

GROUP = ("239.255.255.250", 3702)
MAX_DATAGRAM = 65535
MAX_RESPONSE_BYTES = 64 * 1024
MAX_DEVICES = 1024
NS_ADDRESSING = "http://schemas.xmlsoap.org/ws/2004/08/addressing"


def build_probe(message_id: str) -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" '
        'xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" '
        'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" '
        'xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
        f'<s:Header><a:MessageID>{message_id}</a:MessageID>'
        '<a:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</a:To>'
        '<a:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</a:Action></s:Header>'
        '<s:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></s:Body></s:Envelope>'
    ).encode()


def _scope_value(scopes: list[str], kind: str) -> str | None:
    prefix = f"onvif://www.onvif.org/{kind}/"
    for s in scopes:
        if s.lower().startswith(prefix):
            val = unquote(s[len(prefix):]).strip()
            if val:
                return val[:200]
    return None


def parse_probe_matches(data: bytes, message_id: str, source_ip: str) -> list[dict[str, Any]]:
    """Parse one ProbeMatches datagram. Raises UnsafeXML for hostile payloads."""
    root = safe_fromstring(data, max_bytes=MAX_RESPONSE_BYTES, max_depth=32)
    relates = root.find(f".//{{{NS_ADDRESSING}}}RelatesTo")
    if relates is None or (relates.text or "").strip() != message_id:
        return []
    out = []
    for match in findall_local(root, "ProbeMatch"):
        def vals(name: str, m=match) -> list[str]:
            return [(e.text or "").strip() for e in m.iter() if local(e.tag) == name]
        endpoints = [v for v in vals("Address") if v]
        if not endpoints:
            continue
        xaddrs = " ".join(vals("XAddrs")).split()
        scopes = " ".join(vals("Scopes")).split()
        out.append({
            "endpoint": endpoints[0][:200],
            "address": source_ip,
            "xaddrs": xaddrs[:16],
            "scopes": scopes[:64],
            # Scope strings are self-asserted by the device and unauthenticated.
            "vendor": _scope_value(scopes, "name"),
            "model": _scope_value(scopes, "hardware"),
            "identity_source": "ws_discovery_scopes_unauthenticated",
            "authenticated": False,
        })
    return out


def filter_permitted(device: dict[str, Any], policy: SubnetPolicy, cidr: ipaddress._BaseNetwork | None = None) -> dict[str, Any] | None:
    """Keep the device only if its source address is permitted; drop non-permitted XAddrs."""
    def ok(host: str) -> bool:
        try:
            ip = policy.check_ip(host)
        except TargetNotPermitted:
            return False
        return cidr is None or ip in cidr

    if not ok(device["address"]):
        return None
    kept, rejected = [], 0
    for x in device["xaddrs"]:
        try:
            policy.check_url(x, {"http", "https"})
            host = urlsplit(x).hostname or ""
            if ok(host):
                kept.append(x)
                continue
        except TargetNotPermitted:
            pass
        rejected += 1
    return {**device, "xaddrs": kept, "xaddrs_rejected": rejected}


def local_ipv4_addresses() -> list[str]:
    """Private, non-loopback IPv4 addresses of this host's interfaces (Linux SIOCGIFADDR)."""
    import fcntl
    import struct
    found: list[str] = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        for _, name in socket.if_nameindex():
            try:
                packed = fcntl.ioctl(s.fileno(), 0x8915, struct.pack("256s", name.encode()[:15]))  # SIOCGIFADDR
            except OSError:
                continue  # interface without an IPv4 address
            addr = socket.inet_ntoa(packed[20:24])
            ip = ipaddress.ip_address(addr)
            if ip.is_private and not (ip.is_loopback or ip.is_link_local) and addr not in found:
                found.append(addr)
    return found


def discover(interface: str | None, policy: SubnetPolicy, *, timeout: float = 5.0, cidr: str | None = None,
             group: tuple[str, int] = GROUP, interfaces: list[str] | None = None) -> list[dict[str, Any]]:
    if interface:
        ip = ipaddress.ip_address(interface)
        if ip.version != 4 or ip.is_multicast or ip.is_unspecified:
            raise ValueError("a local unicast IPv4 interface address is required")
        senders = [interface]
    else:
        senders = interfaces if interfaces is not None else local_ipv4_addresses()
        if not senders:
            raise ValueError("no private IPv4 interface found on the appliance")
    if not 0 < timeout <= 30:
        raise ValueError("timeout must be in (0, 30] seconds")
    net = policy.check_cidr_within(cidr) if cidr else None
    message_id = "urn:uuid:" + str(uuid.uuid4())
    results: dict[str, dict[str, Any]] = {}
    deadline = time.monotonic() + timeout
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.bind((interface or "0.0.0.0", 0))
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 1)
        sent = 0
        for addr in senders:
            try:
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_IF, socket.inet_aton(addr))
                sock.sendto(build_probe(message_id), group)
                sent += 1
            except OSError:
                if interface:
                    raise
        if not sent:
            raise ValueError("the probe could not be sent from any interface")
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            sock.settimeout(min(0.5, remaining))
            try:
                data, addr = sock.recvfrom(MAX_DATAGRAM)
            except socket.timeout:
                continue
            try:
                matches = parse_probe_matches(data, message_id, addr[0])
            except UnsafeXML:
                continue
            for dev in matches:
                kept = filter_permitted(dev, policy, net)
                if kept is None:
                    continue
                prev = results.get(kept["endpoint"])
                if prev is None:
                    if len(results) < MAX_DEVICES:
                        results[kept["endpoint"]] = kept
                else:  # duplicate endpoint (multi-NIC device / repeated answer): merge XAddrs
                    prev["xaddrs"] = sorted(set(prev["xaddrs"]) | set(kept["xaddrs"]))
    return sorted(results.values(), key=lambda d: (d["address"], d["endpoint"]))


__all__ = ["discover", "local_ipv4_addresses", "parse_probe_matches", "filter_permitted", "build_probe", "find_local"]
