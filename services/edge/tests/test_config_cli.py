import json
import os
import stat
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from retailguard_edge.config import ConfigError, ensure_state_dir, load_config, validate_api_url
from conftest import has_mode


def test_api_url_must_be_https_except_loopback():
    assert validate_api_url("https://api.example.com/") == "https://api.example.com"
    assert validate_api_url("http://127.0.0.1:8000") == "http://127.0.0.1:8000"
    for bad in ("http://api.example.com", "ftp://x", "https://u:p@api.example.com", "https://api.example.com/?a=1"):
        with pytest.raises(ConfigError):
            validate_api_url(bad)


def test_toml_and_env_precedence(tmp_path):
    cfg = tmp_path / "c.toml"
    cfg.write_text('[edge]\napi_base_url = "https://a.example"\ndisk_budget_bytes = 1073741824\n'
                   'heartbeat_interval_s = 20\n')
    c = load_config(cfg, env={"RETAILGUARD_EDGE_API": "https://b.example", "RETAILGUARD_EDGE_STATE_DIR": str(tmp_path)})
    assert c.api_base_url == "https://b.example" and c.disk_budget_bytes == 1024**3
    assert c.heartbeat_interval_s == 20 and c.state_dir == tmp_path
    with pytest.raises(ConfigError):
        load_config(cfg, env={"RETAILGUARD_EDGE_INTERFACE": "not-an-ip"})
    bad = tmp_path / "bad.toml"
    bad.write_text("[edge]\nnope = 1\n")
    with pytest.raises(ConfigError):
        load_config(bad, env={})


def test_state_dir_created_0700(tmp_path):
    d = tmp_path / "x"
    d.mkdir(mode=0o755)
    ensure_state_dir(d)
    assert has_mode(d, 0o700)
    assert has_mode(d / "spool", 0o700)


def _cli(*args, env_extra=None):
    env = {**os.environ, "RETAILGUARD_EDGE_CONFIG": "/nonexistent.toml", **(env_extra or {})}
    return subprocess.run([sys.executable, "-m", "retailguard_edge", *args], capture_output=True, text=True,
                          env=env, timeout=60)


def test_cli_pair_then_status(tmp_path):
    received = {}

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_POST(self):
            received["path"] = self.path
            received["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            data = json.dumps({"edge_id": "e-cli", "org_id": "o", "store_id": "s", "store_timezone": "Asia/Tokyo",
                               "allowed_subnets": ["192.168.50.0/24"], "api_version": 1}).encode()
            self.send_response(201)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    sd = tmp_path / "state"
    try:
        r = _cli("--state-dir", str(sd), "pair", "--api", f"http://127.0.0.1:{srv.server_address[1]}",
                 "--code", "ONE-TIME-777", "--name", "edge-a")
    finally:
        srv.shutdown()
        srv.server_close()
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["edge_id"] == "e-cli" and len(out["fingerprint"]) == 64
    assert received["path"] == "/v1/edge/pair" and received["body"]["code"] == "ONE-TIME-777"
    assert "ONE-TIME-777" not in r.stderr
    s = _cli("--state-dir", str(sd), "status")
    assert s.returncode == 0, s.stderr
    st = json.loads(s.stdout)
    assert st["paired"] and st["edge_id"] == "e-cli" and st["allowed_subnets"] == ["192.168.50.0/24"]
    assert st["channels"]["behavior"] == {"state": "unavailable", "reason": "model_not_installed"}
    assert "sign.key" not in s.stdout and "PRIVATE" not in s.stdout.upper()


def test_cli_probe_file(video_12s, video_3s):
    ok = _cli("probe", "--source", str(video_12s))
    assert ok.returncode == 0 and json.loads(ok.stdout)["readiness"] == "ready"
    short = _cli("probe", "--source", str(video_3s))
    assert short.returncode == 1 and json.loads(short.stdout)["readiness"] == "degraded"


def test_cli_run_requires_pairing(tmp_path):
    r = _cli("--state-dir", str(tmp_path / "s"), "run")
    assert r.returncode == 2 and "not paired" in r.stderr
