import base64
import socket

import pytest

from fake_onvif import FakeOnvif
from retailguard_edge.netpolicy import SubnetPolicy, TargetNotPermitted
from retailguard_edge.onvif import (OnvifClient, OnvifError, device_service_url, password_digest, probe_device,
                                    select_profile)
from retailguard_edge.vault import Credentials
from retailguard_edge.xmlsafe import UnsafeXML, safe_fromstring

CREDS = Credentials("viewer", "pa55:w@rd")


@pytest.fixture
def policy(private_ip):
    return SubnetPolicy.from_cidrs([f"{private_ip}/32"])


def test_password_digest_onvif_spec_vector():
    # Example from the ONVIF Application Programmer's Guide (UsernameToken digest).
    nonce = base64.b64decode("LKqI6G/AikKCQrN0zqZFlg==")
    assert password_digest(nonce, "2010-09-16T07:50:45Z", "userpassword") == "tuOSpGlFlIXsozq4HFNeeGeFLEI="


def test_full_probe_with_usernametoken_digest(private_ip, policy):
    with FakeOnvif(private_ip) as dev, OnvifClient(dev.device_url, policy, CREDS) as oc:
        report = probe_device(oc, "substream")
    assert report["device"]["manufacturer"] == "TestVendor" and report["device"]["model"] == "TV-100"
    assert report["auth_method"] == "ws_usernametoken_digest"
    assert report["media_service"] == "media1"
    assert [p["token"] for p in report["profiles"]] == ["Profile_1", "Profile_2"]
    assert report["selected_profile"]["token"] == "Profile_2"  # substream = smallest
    assert report["selected_profile"]["width"] == 640 and report["selected_profile"]["fps_limit"] == 15
    assert report["stream_uri"] == f"rtsp://{private_ip}:8554/test"
    assert report["snapshot_uri"].endswith("/snap.jpg")
    assert abs(report["time"]["clock_offset_s"]) < 3
    ops = [(e["op"], e["auth"]) for e in dev.log]
    assert ops[0] == ("GetSystemDateAndTime", None)  # unauthenticated time query first
    assert all(auth == "ok" for op, auth in ops[1:]), ops  # every other call carried a valid digest
    assert {"GetDeviceInformation", "GetCapabilities", "GetProfiles", "GetStreamUri", "GetSnapshotUri"} <= {o for o, _ in ops}


def test_mainstream_selects_largest():
    profiles = [{"token": "a", "encoding": "H264", "width": 640, "height": 360},
                {"token": "b", "encoding": "H264", "width": 1920, "height": 1080},
                {"token": "c", "encoding": "JPEG", "width": 3840, "height": 2160}]
    assert select_profile(profiles, "mainstream")["token"] == "b"
    assert select_profile(profiles, "substream")["token"] == "a"


def test_wrong_password_is_auth_failed(private_ip, policy):
    with FakeOnvif(private_ip) as dev, OnvifClient(dev.device_url, policy, Credentials("viewer", "wrong")) as oc:
        oc.get_system_date_and_time()
        with pytest.raises(OnvifError) as ei:
            oc.get_device_information()
    assert ei.value.code == "auth_failed"
    assert dev.log[-1]["auth"] == "bad_digest"


def test_device_clock_offset_is_compensated(private_ip, policy):
    with FakeOnvif(private_ip, clock_offset_s=3600) as dev, OnvifClient(dev.device_url, policy, CREDS) as oc:
        t = oc.get_system_date_and_time()
        info = oc.get_device_information()
    assert 3595 < t["clock_offset_s"] < 3605
    assert info["serial_number"] == "SN0001"


def test_bad_clock_diagnosed_as_clock_skew(private_ip, policy):
    with FakeOnvif(private_ip, clock_offset_s=-7200, reject_all=True) as dev, \
            OnvifClient(dev.device_url, policy, CREDS) as oc:
        oc.get_system_date_and_time()
        with pytest.raises(OnvifError) as ei:
            oc.get_device_information()
    assert ei.value.code == "clock_skew"


def test_http_digest_fallback(private_ip, policy):
    with FakeOnvif(private_ip, mode="digest_only") as dev, OnvifClient(dev.device_url, policy, CREDS) as oc:
        report = probe_device(oc)
    assert report["auth_method"] == "http_digest"
    assert dev.log[-1]["auth"] == "http_digest_ok"
    with FakeOnvif(private_ip, mode="digest_only") as dev, \
            OnvifClient(dev.device_url, policy, Credentials("viewer", "nope")) as oc:
        with pytest.raises(OnvifError) as ei:
            oc.get_device_information()
    assert ei.value.code == "auth_failed"


def test_dtd_entity_response_rejected(private_ip, policy):
    with FakeOnvif(private_ip, mode="dtd") as dev, OnvifClient(dev.device_url, policy, CREDS) as oc:
        with pytest.raises(OnvifError) as ei:
            oc.get_system_date_and_time()
    assert ei.value.code == "invalid_response" and "xml_dtd_rejected" in ei.value.detail


def test_xmlsafe_bounds():
    with pytest.raises(UnsafeXML, match="xml_dtd_rejected"):
        safe_fromstring(b'<?xml version="1.0"?><!doctype x [<!entity a "b">]><x>&a;</x>')
    with pytest.raises(UnsafeXML, match="xml_too_large"):
        safe_fromstring(b"<a>" + b"x" * 2000 + b"</a>", max_bytes=1000)
    with pytest.raises(UnsafeXML, match="xml_too_deep"):
        safe_fromstring(b"<a>" * 100 + b"</a>" * 100, max_depth=64)
    with pytest.raises(UnsafeXML, match="xml_dtd_rejected"):
        safe_fromstring('<?xml version="1.0" encoding="utf-16"?><!DOCTYPE x><x/>'.encode("utf-16-le"))


def test_onvif_disabled(private_ip, policy):
    with FakeOnvif(private_ip, mode="disabled") as dev, OnvifClient(dev.device_url, policy, CREDS) as oc:
        with pytest.raises(OnvifError) as ei:
            oc.get_system_date_and_time()
    assert ei.value.code == "onvif_disabled"


def test_redirect_not_followed(private_ip, policy):
    with FakeOnvif(private_ip, mode="redirect") as dev, OnvifClient(dev.device_url, policy, CREDS) as oc:
        with pytest.raises(OnvifError) as ei:
            oc.get_system_date_and_time()
    assert ei.value.code == "target_not_permitted" and ei.value.detail == "redirect_rejected"


def test_stream_uri_outside_subnet_rejected(private_ip, policy):
    with FakeOnvif(private_ip, stream_uri="rtsp://169.254.169.254:554/x") as dev, \
            OnvifClient(dev.device_url, policy, CREDS) as oc:
        with pytest.raises(OnvifError) as ei:
            probe_device(oc)
    assert ei.value.code == "target_not_permitted"


def test_stream_uri_with_embedded_credentials_rejected(private_ip, policy):
    with FakeOnvif(private_ip, stream_uri=f"rtsp://admin:x@{private_ip}/x") as dev, \
            OnvifClient(dev.device_url, policy, CREDS) as oc:
        with pytest.raises(OnvifError) as ei:
            probe_device(oc)
    assert ei.value.code == "target_not_permitted"


def test_unreachable(private_ip, policy):
    s = socket.socket()
    s.bind((private_ip, 0))
    port = s.getsockname()[1]
    s.close()  # nothing listening now
    with OnvifClient(f"http://{private_ip}:{port}/onvif/device_service", policy, CREDS, timeout=2) as oc:
        with pytest.raises(OnvifError) as ei:
            oc.get_system_date_and_time()
    assert ei.value.code == "unreachable"


def test_forbidden_device_address_rejected_before_connecting(policy):
    for url in ("http://127.0.0.1/onvif/device_service", "http://169.254.169.254/", "http://8.8.8.8/",
                "http://camera.example.com/onvif/device_service"):
        with pytest.raises(TargetNotPermitted):
            OnvifClient(url, policy, CREDS)


def test_device_service_url_forms():
    assert device_service_url("192.168.1.5") == "http://192.168.1.5/onvif/device_service"
    assert device_service_url("192.168.1.5:8080") == "http://192.168.1.5:8080/onvif/device_service"
    assert device_service_url("https://192.168.1.5/onvif/device_service") == "https://192.168.1.5/onvif/device_service"
