import ipaddress
import re
import socket
import threading

import pytest

from retailguard_edge.discovery import (build_probe, discover, filter_permitted, local_ipv4_addresses,
                                        parse_probe_matches)
from retailguard_edge.netpolicy import SubnetPolicy
from retailguard_edge.xmlsafe import UnsafeXML


def probe_match(relates: str, endpoint: str, xaddrs: str, scopes: str = "") -> bytes:
    return f'''<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
 xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery">
<s:Header><a:RelatesTo>{relates}</a:RelatesTo></s:Header><s:Body><d:ProbeMatches><d:ProbeMatch>
<a:EndpointReference><a:Address>{endpoint}</a:Address></a:EndpointReference>
<d:Types>dn:NetworkVideoTransmitter</d:Types><d:Scopes>{scopes}</d:Scopes><d:XAddrs>{xaddrs}</d:XAddrs>
</d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>'''.encode()


def test_parse_and_scopes():
    data = probe_match("urn:uuid:1", "urn:uuid:dev-a", "http://192.168.1.10/onvif/device_service",
                       "onvif://www.onvif.org/name/ACME%20Cam onvif://www.onvif.org/hardware/X100")
    [dev] = parse_probe_matches(data, "urn:uuid:1", "192.168.1.10")
    assert dev["endpoint"] == "urn:uuid:dev-a" and dev["vendor"] == "ACME Cam" and dev["model"] == "X100"
    assert dev["authenticated"] is False
    assert parse_probe_matches(data, "urn:uuid:other", "192.168.1.10") == []  # unrelated reply ignored


def test_dtd_payload_rejected():
    evil = b'<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'
    with pytest.raises(UnsafeXML):
        parse_probe_matches(evil, "urn:uuid:1", "192.168.1.10")


def test_subnet_filtering():
    policy = SubnetPolicy.from_cidrs(["192.168.1.0/24"])
    dev = {"endpoint": "e", "address": "192.168.1.10", "scopes": [],
           "xaddrs": ["http://192.168.1.10/onvif/device_service", "http://169.254.169.254/latest",
                      "http://10.0.0.1/onvif", "http://192.168.1.10.evil.com/x"]}
    kept = filter_permitted(dev, policy)
    assert kept["xaddrs"] == ["http://192.168.1.10/onvif/device_service"] and kept["xaddrs_rejected"] == 3
    assert filter_permitted({**dev, "address": "10.9.9.9"}, policy) is None
    assert filter_permitted({**dev, "address": "127.0.0.1"}, policy) is None


def test_real_udp_probe_exchange_dedupes_and_filters(private_ip):
    """Real sockets: the responder answers the actual Probe (unicast in-test; multicast in stores)."""
    responder = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    responder.bind((private_ip, 0))
    responder.settimeout(5)
    port = responder.getsockname()[1]
    got = {}

    def respond():
        data, addr = responder.recvfrom(65535)
        got["probe"] = data
        mid = re.search(rb"<a:MessageID>([^<]+)</a:MessageID>", data).group(1).decode()
        good = probe_match(mid, "urn:uuid:cam-1",
                           f"http://{private_ip}/onvif/device_service http://169.254.169.254/x")
        responder.sendto(good, addr)
        responder.sendto(good, addr)  # duplicate answer
        responder.sendto(b'<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', addr)
        responder.sendto(probe_match(mid, "urn:uuid:cam-2", "http://8.8.8.8/onvif"), addr)

    t = threading.Thread(target=respond)
    t.start()
    policy = SubnetPolicy.from_cidrs([f"{private_ip}/32"])
    devices = discover(private_ip, policy, timeout=1.5, group=(private_ip, port))
    t.join()
    responder.close()
    assert b"NetworkVideoTransmitter" in got["probe"]
    by_ep = {d["endpoint"]: d for d in devices}
    assert sorted(by_ep) == ["urn:uuid:cam-1", "urn:uuid:cam-2"]  # duplicate answer merged, DTD datagram dropped
    assert by_ep["urn:uuid:cam-1"]["xaddrs"] == [f"http://{private_ip}/onvif/device_service"]
    assert by_ep["urn:uuid:cam-1"]["xaddrs_rejected"] == 1
    # cam-2 replied from a permitted source but advertises only a public XAddr: listed, nothing usable
    assert by_ep["urn:uuid:cam-2"]["xaddrs"] == [] and by_ep["urn:uuid:cam-2"]["xaddrs_rejected"] == 1


def test_input_validation():
    policy = SubnetPolicy.from_cidrs(["192.168.1.0/24"])
    with pytest.raises(ValueError):
        discover("239.255.255.250", policy)
    with pytest.raises(ValueError):
        discover("192.168.1.2", policy, timeout=60)
    assert b"<d:Probe>" in build_probe("urn:uuid:x")


def test_probe_without_interface_uses_every_given_interface(private_ip):
    """No interface chosen by the operator: one socket bound to all addresses sends the probe from each
    private interface and collects answers in one window."""
    responder = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    responder.bind((private_ip, 0))
    responder.settimeout(5)
    port = responder.getsockname()[1]

    def respond():
        data, addr = responder.recvfrom(65535)
        mid = re.search(rb"<a:MessageID>([^<]+)</a:MessageID>", data).group(1).decode()
        responder.sendto(probe_match(mid, "urn:uuid:cam-9", f"http://{private_ip}/onvif/device_service"), addr)

    t = threading.Thread(target=respond)
    t.start()
    policy = SubnetPolicy.from_cidrs([f"{private_ip}/32"])
    devices = discover(None, policy, timeout=1.5, group=(private_ip, port), interfaces=[private_ip])
    t.join()
    responder.close()
    assert [d["endpoint"] for d in devices] == ["urn:uuid:cam-9"]
    with pytest.raises(ValueError):
        discover(None, policy, interfaces=[])
    assert all(ipaddress.ip_address(a).is_private for a in local_ipv4_addresses())
