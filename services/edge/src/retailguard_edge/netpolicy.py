"""Target allowlist: camera/ONVIF/RTSP destinations must be inside the store's
allowed subnets (from the pairing response). Prevents camera SSRF.

Hostnames are rejected (no DNS resolution => no DNS rebinding); cameras are
addressed by IP literal. Loopback, link-local (incl. 169.254.169.254 cloud
metadata), multicast, unspecified and reserved addresses are always rejected,
even if an allowed subnet were misconfigured to include them.
"""
from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from urllib.parse import urlsplit

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


class TargetNotPermitted(Exception):
    code = "target_not_permitted"

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _normalize(ip: IPAddress) -> IPAddress:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def _forbidden_reason(ip: IPAddress) -> str | None:
    if ip.is_loopback:
        return "loopback"
    if ip.is_link_local:
        return "link_local"
    if ip.is_multicast:
        return "multicast"
    if ip.is_unspecified:
        return "unspecified"
    if ip.is_reserved:
        return "reserved"
    if not ip.is_private:
        return "public_address"
    return None


def parse_allowed_subnets(cidrs: list[str]) -> list[IPNetwork]:
    """Validate pairing-provided CIDRs. Each must be a private, non-special range."""
    nets: list[IPNetwork] = []
    if not isinstance(cidrs, list):
        raise ValueError("allowed_subnets must be a list")
    for cidr in cidrs:
        if not isinstance(cidr, str):
            raise ValueError("allowed_subnets entries must be strings")
        net = ipaddress.ip_network(cidr, strict=False)
        for probe in (net.network_address, net.broadcast_address):
            reason = _forbidden_reason(_normalize(probe))
            if reason:
                raise ValueError(f"allowed subnet {cidr} is not a private camera range ({reason})")
        nets.append(net)
    return nets


@dataclass(frozen=True)
class SubnetPolicy:
    networks: tuple[IPNetwork, ...]

    @classmethod
    def from_cidrs(cls, cidrs: list[str]) -> "SubnetPolicy":
        return cls(tuple(parse_allowed_subnets(cidrs)))

    def check_ip(self, host: str) -> IPAddress:
        host = host.strip()
        if host.startswith("[") and host.endswith("]"):
            host = host[1:-1]
        try:
            ip = _normalize(ipaddress.ip_address(host.split("%", 1)[0]))
        except ValueError:
            raise TargetNotPermitted("hostname_not_allowed") from None
        reason = _forbidden_reason(ip)
        if reason:
            raise TargetNotPermitted(reason)
        if not any(ip in net for net in self.networks if net.version == ip.version):
            raise TargetNotPermitted("outside_allowed_subnets")
        return ip

    def is_permitted(self, host: str) -> bool:
        try:
            self.check_ip(host)
            return True
        except TargetNotPermitted:
            return False

    def check_url(self, url: str, schemes: frozenset[str] | set[str]) -> str:
        """Validate scheme + host + port of a URL. Returns the URL unchanged.

        URLs carrying userinfo are rejected: credentials are only ever injected
        locally from the vault, never accepted from device responses.
        """
        try:
            parts = urlsplit(url)
            port = parts.port
        except ValueError:
            raise TargetNotPermitted("malformed_url") from None
        if parts.scheme.lower() not in schemes:
            raise TargetNotPermitted("scheme_not_allowed")
        if parts.username is not None or parts.password is not None:
            raise TargetNotPermitted("userinfo_not_allowed")
        if not parts.hostname:
            raise TargetNotPermitted("missing_host")
        if port is not None and not 0 < port < 65536:
            raise TargetNotPermitted("invalid_port")
        self.check_ip(parts.hostname)
        return url

    def check_cidr_within(self, cidr: str) -> IPNetwork:
        """A discovery CIDR requested by the server must lie inside an allowed subnet."""
        try:
            net = ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            raise TargetNotPermitted("malformed_cidr") from None
        if not any(net.version == a.version and net.subnet_of(a) for a in self.networks):  # type: ignore[arg-type]
            raise TargetNotPermitted("outside_allowed_subnets")
        return net
