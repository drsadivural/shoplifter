import hashlib
import json

import pytest

from retailguard_edge.pipeline import ChannelRegistry, coco17_to_model_layout


def test_no_models_installed_everything_unavailable():
    reg = ChannelRegistry()
    assert reg.status("behavior").to_dict() == {"state": "unavailable", "reason": "model_not_installed"}
    assert reg.status("watchlist").to_dict() == {"state": "unavailable", "reason": "face_sdk_unavailable"}
    assert reg.status("checkout").to_dict() == {"state": "unavailable", "reason": "pos_unconfigured"}
    assert reg.models() == []
    res = reg.activate("cam", ["behavior", "watchlist"], [], {})
    assert res == {"behavior": {"state": "unavailable", "reason": "model_not_installed"},
                   "watchlist": {"state": "unavailable", "reason": "face_sdk_unavailable"},
                   "checkout": {"state": "not_requested"}}


def _manifest(tmp_path, **over):
    art = tmp_path / "weights.bin"
    art.write_bytes(b"weights")
    m = {"name": "behavior-x", "version": "1", "channel": "behavior", "runtime": "definitely_not_a_runtime_xyz",
         "adapter": "nowhere:Nothing", "artifact": str(art), "sha256": hashlib.sha256(b"weights").hexdigest()}
    m.update(over)
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps(m))
    return p


def test_manifest_without_importable_runtime(tmp_path):
    reg = ChannelRegistry(model_manifest=_manifest(tmp_path))
    assert reg.status("behavior").reason == "runtime_unavailable"


def test_manifest_checksum_mismatch(tmp_path):
    reg = ChannelRegistry(model_manifest=_manifest(tmp_path, sha256="0" * 64))
    assert reg.status("behavior").reason == "artifact_checksum_mismatch"


def test_runtime_importable_but_no_adapter(tmp_path):
    reg = ChannelRegistry(model_manifest=_manifest(tmp_path, runtime="json"))
    assert reg.status("behavior").to_dict() == {"state": "unavailable", "reason": "adapter_unavailable"}


def test_invalid_manifest_and_pos(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{}")
    pos = tmp_path / "pos.json"
    pos.write_text("{}")
    reg = ChannelRegistry(model_manifest=bad, pos_config=pos)
    assert reg.status("behavior").reason == "manifest_invalid"
    assert reg.status("checkout").reason == "model_not_installed"


def test_keypoint_adapter_is_explicit_stub():
    with pytest.raises(NotImplementedError, match="upstream"):
        coco17_to_model_layout([[0, 0, 1]] * 17)
