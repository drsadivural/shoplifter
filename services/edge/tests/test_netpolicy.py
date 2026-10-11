import pytest

from retailguard_edge.netpolicy import SubnetPolicy, TargetNotPermitted, parse_allowed_subnets

POLICY = SubnetPolicy.from_cidrs(["192.168.10.0/24", "10.20.0.0/16"])


@pytest.mark.parametrize("host,reason", [
    ("169.254.169.254", "link_local"),
    ("127.0.0.1", "loopback"),
    ("::1", "loopback"),
    ("::ffff:127.0.0.1", "loopback"),
    ("8.8.8.8", "public_address"),
    ("1.1.1.1", "public_address"),
    ("192.168.11.5", "outside_allowed_subnets"),
    ("172.16.0.10", "outside_allowed_subnets"),
    ("0.0.0.0", "unspecified"),
    ("239.255.255.250", "multicast"),
    ("camera.local", "hostname_not_allowed"),
    ("metadata.google.internal", "hostname_not_allowed"),
])
def test_rejects(host, reason):
    with pytest.raises(TargetNotPermitted) as ei:
        POLICY.check_ip(host)
    assert ei.value.reason == reason


@pytest.mark.parametrize("host", ["192.168.10.1", "192.168.10.254", "10.20.3.4", "::ffff:192.168.10.7"])
def test_accepts_allowed(host):
    POLICY.check_ip(host)


def test_url_checks():
    assert POLICY.check_url("http://192.168.10.5/onvif/device_service", {"http", "https"})
    assert POLICY.check_url("rtsp://192.168.10.5:554/Streaming/Channels/102", {"rtsp"})
    for url, schemes, reason in [
        ("http://169.254.169.254/latest/meta-data", {"http"}, "link_local"),
        ("file:///etc/passwd", {"http"}, "scheme_not_allowed"),
        ("rtsp://192.168.10.5/x", {"http", "https"}, "scheme_not_allowed"),
        ("http://user:pw@192.168.10.5/", {"http"}, "userinfo_not_allowed"),
        ("http://192.168.10.5:99999/", {"http"}, "malformed_url"),
        ("http:///nohost", {"http"}, "missing_host"),
    ]:
        with pytest.raises(TargetNotPermitted) as ei:
            POLICY.check_url(url, schemes)
        assert ei.value.reason == reason, url


def test_pairing_subnets_must_be_private():
    for bad in (["0.0.0.0/0"], ["8.8.8.0/24"], ["127.0.0.0/8"], ["169.254.0.0/16"], "10.0.0.0/8", [5]):
        with pytest.raises(ValueError):
            parse_allowed_subnets(bad)
    assert len(parse_allowed_subnets(["10.0.0.0/8", "fd00::/8"])) == 2


def test_cidr_within():
    POLICY.check_cidr_within("192.168.10.0/25")
    with pytest.raises(TargetNotPermitted):
        POLICY.check_cidr_within("192.168.0.0/16")
    with pytest.raises(TargetNotPermitted):
        POLICY.check_cidr_within("garbage")


def test_empty_policy_rejects_everything():
    with pytest.raises(TargetNotPermitted):
        SubnetPolicy.from_cidrs([]).check_ip("192.168.1.1")
