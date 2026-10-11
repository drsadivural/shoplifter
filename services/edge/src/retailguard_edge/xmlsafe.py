"""Hardened XML parsing for untrusted device responses (WS-Discovery, ONVIF SOAP).

Rejects any DTD / entity declaration before parsing, bounds the input size and
the element nesting depth. xml.etree with expat never fetches external
entities; rejecting DOCTYPE outright also prevents internal entity expansion.
"""
from __future__ import annotations

import io
import xml.etree.ElementTree as ET

DEFAULT_MAX_BYTES = 1024 * 1024
DEFAULT_MAX_DEPTH = 64


class UnsafeXML(ValueError):
    pass


def safe_fromstring(data: bytes, *, max_bytes: int = DEFAULT_MAX_BYTES, max_depth: int = DEFAULT_MAX_DEPTH) -> ET.Element:
    if not isinstance(data, (bytes, bytearray)):
        raise UnsafeXML("xml_not_bytes")
    if len(data) > max_bytes:
        raise UnsafeXML("xml_too_large")
    upper = bytes(data).upper()
    # Check both the raw and the UTF-16 forms of the markers.
    for marker in (b"<!DOCTYPE", b"<!ENTITY", "<!DOCTYPE".encode("utf-16-le"), "<!ENTITY".encode("utf-16-le"),
                   "<!DOCTYPE".encode("utf-16-be"), "<!ENTITY".encode("utf-16-be")):
        if marker in upper:
            raise UnsafeXML("xml_dtd_rejected")
    depth = 0
    root: ET.Element | None = None
    try:
        for event, elem in ET.iterparse(io.BytesIO(bytes(data)), events=("start", "end")):
            if event == "start":
                depth += 1
                if root is None:
                    root = elem
                if depth > max_depth:
                    raise UnsafeXML("xml_too_deep")
            else:
                depth -= 1
    except ET.ParseError as exc:
        raise UnsafeXML("xml_parse_error") from exc
    if root is None:
        raise UnsafeXML("xml_empty")
    return root


def local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def find_local(elem: ET.Element, name: str) -> ET.Element | None:
    for e in elem.iter():
        if local(e.tag) == name:
            return e
    return None


def findall_local(elem: ET.Element, name: str) -> list[ET.Element]:
    return [e for e in elem.iter() if local(e.tag) == name]


def child_text(elem: ET.Element | None, name: str) -> str | None:
    if elem is None:
        return None
    for e in elem:
        if local(e.tag) == name:
            return (e.text or "").strip()
    return None
