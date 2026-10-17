"""retailguard-edge command line.

  retailguard-edge pair --api URL --code CODE --name NAME
  retailguard-edge run
  retailguard-edge discover [--interface IP] [--timeout S] [--cidr CIDR]
  retailguard-edge status
  retailguard-edge probe --source URL_OR_FILE [--username U]   (password from RETAILGUARD_EDGE_PROBE_PASSWORD or prompt)
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import signal
import sys
import threading
from pathlib import Path
from typing import Any

from . import __version__
from .config import ConfigError, EdgeConfig, ensure_state_dir, load_config
from .redact import configure_logging, redact_text


def _out(obj: Any) -> None:
    print(json.dumps(obj, indent=2, default=str))


def _config(args: argparse.Namespace) -> EdgeConfig:
    cfg = load_config(Path(args.config) if args.config else None)
    return cfg.with_overrides(state_dir=args.state_dir, api_base_url=getattr(args, "api", None))


def cmd_pair(args: argparse.Namespace) -> int:
    from .identity import IdentityError, pair
    cfg = _config(args)
    ensure_state_dir(cfg.state_dir)
    try:
        state = pair(cfg.api_base_url or args.api, args.code, args.name, cfg.state_dir,
                     timeout=cfg.request_timeout_s, processing_mode=args.mode or cfg.processing_mode)
    except IdentityError as exc:
        print(f"pairing failed: {exc.code}: {redact_text(str(exc), [args.code])}", file=sys.stderr)
        return 2
    from .identity import load_mode, load_or_create_keys
    keys = load_or_create_keys(cfg.state_dir)
    _out({"paired": True, "edge_id": state.edge_id, "org_id": state.org_id, "store_id": state.store_id,
          "allowed_subnets": state.allowed_subnets, "fingerprint": keys.fingerprint,
          "processing_mode": load_mode(cfg.state_dir)})
    return 0


def _load_identity(cfg: EdgeConfig):
    from .identity import load_or_create_keys, load_pairing
    pairing = load_pairing(cfg.state_dir)
    if pairing is None:
        print("edge is not paired: run `retailguard-edge pair` first", file=sys.stderr)
        raise SystemExit(2)
    return load_or_create_keys(cfg.state_dir), pairing


def cmd_run(args: argparse.Namespace) -> int:
    from .agent import Agent
    from .client import EdgeClient
    cfg = _config(args)
    ensure_state_dir(cfg.state_dir)
    keys, pairing = _load_identity(cfg)
    api = cfg.api_base_url or pairing.api_base_url
    client = EdgeClient(api, pairing.edge_id, keys.signing_key, timeout=cfg.request_timeout_s)
    agent = Agent(cfg, keys, pairing, client)
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    import logging
    logging.getLogger("retailguard_edge").info(
        "edge %s running (store %s, api %s, software %s); channels: %s", pairing.edge_id, pairing.store_id, api,
        __version__, {ch: agent.registry.status(ch).to_dict() for ch in ("behavior", "watchlist", "checkout")})
    try:
        agent.run(stop)
    finally:
        client.close()
    return 0


def cmd_discover(args: argparse.Namespace) -> int:
    from .discovery import discover
    from .identity import load_pairing
    from .netpolicy import SubnetPolicy
    cfg = _config(args)
    pairing = load_pairing(cfg.state_dir) if cfg.state_dir.exists() else None
    if pairing is not None:
        policy = SubnetPolicy.from_cidrs(pairing.allowed_subnets)
    elif args.cidr:
        policy = SubnetPolicy.from_cidrs([args.cidr])  # unpaired diagnostics: explicit private CIDR required
    else:
        print("not paired: pass --cidr <private camera subnet> to bound results", file=sys.stderr)
        return 2
    interface = args.interface or cfg.discovery_interface or None  # None: every private interface
    try:
        devices = discover(interface, policy, timeout=args.timeout, cidr=args.cidr)
    except (OSError, ValueError) as exc:
        print(f"discovery failed: {exc}", file=sys.stderr)
        return 1
    _out({"devices": devices, "note": "Discovery only. Devices are unauthenticated until provisioned."})
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    from .identity import load_or_create_keys, load_pairing
    from .pipeline import ChannelRegistry
    cfg = _config(args)
    pairing = load_pairing(cfg.state_dir) if cfg.state_dir.exists() else None
    out: dict[str, Any] = {"software_version": __version__, "state_dir": str(cfg.state_dir), "paired": pairing is not None}
    if pairing is not None:
        keys = load_or_create_keys(cfg.state_dir)
        out.update({"edge_id": pairing.edge_id, "org_id": pairing.org_id, "store_id": pairing.store_id,
                    "api_base_url": pairing.api_base_url, "allowed_subnets": pairing.allowed_subnets,
                    "fingerprint": keys.fingerprint})
    reg = ChannelRegistry(model_manifest=cfg.model_manifest, face_sdk_manifest=cfg.face_sdk_manifest,
                          pos_config=cfg.pos_config)
    out["channels"] = {ch: reg.status(ch).to_dict() for ch in ("behavior", "watchlist", "checkout")}
    if cfg.state_dir.exists():
        usage = shutil.disk_usage(cfg.state_dir)
        out["disk"] = {"free_bytes": usage.free, "total_bytes": usage.total, "budget_bytes": cfg.disk_budget_bytes}
        if (cfg.state_dir / "edge.db").exists():
            from .agent import EdgeStore
            store = EdgeStore(cfg.state_dir / "edge.db")
            out["cameras"] = [{k: c.get(k) for k in ("camera_id", "address", "readiness", "analysis_state",
                                                       "channels", "zones_version")} for c in store.cameras()]
            store.close()
        status_path = cfg.state_dir / "status.json"
        if status_path.exists():
            last = json.loads(status_path.read_text())
            out["last_heartbeat"] = {"at": last.get("at"), "outbox": last.get("outbox"),
                                     "cameras": last.get("heartbeat", {}).get("cameras")}
    for tool in (cfg.ffmpeg_path, cfg.ffprobe_path):
        out.setdefault("tools", {})[tool] = shutil.which(tool)
    _out(out)
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    from .stream import StreamSource, probe_readiness
    from .vault import Credentials
    cfg = _config(args)
    creds = None
    if args.username:
        pwd = os.environ.get("RETAILGUARD_EDGE_PROBE_PASSWORD") or getpass.getpass("camera password: ")
        creds = Credentials(args.username, pwd)
    src = args.source
    if "://" not in src:
        src = str(Path(src).resolve())
    report = probe_readiness(StreamSource(src, creds), sample_seconds=cfg.sample_seconds,
                             required_seconds=cfg.required_decoded_seconds, ffprobe=cfg.ffprobe_path)
    _out(report.to_dict())
    return 0 if report.readiness == "ready" else 1


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="retailguard-edge", description="RetailGuard store edge appliance")
    ap.add_argument("--version", action="version", version=__version__)
    ap.add_argument("--config", help="TOML config path (default /etc/retailguard-edge/config.toml)")
    ap.add_argument("--state-dir", help="state directory (default /var/lib/retailguard-edge)")
    ap.add_argument("--log-file", help="also write logs to this file (rotated at 10 MB)")
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("pair", help="pair this appliance with a store using a one-time code")
    p.add_argument("--api", required=True)
    p.add_argument("--code", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--mode", choices=("streaming", "full"),
                   help="streaming: live view only; full: also run installed analysis models (default: config)")
    p.set_defaults(func=cmd_pair)
    r = sub.add_parser("run", help="run the edge agent loop")
    r.set_defaults(func=cmd_run)
    d = sub.add_parser("discover", help="WS-Discovery probe (all private interfaces unless --interface)")
    d.add_argument("--interface")
    d.add_argument("--timeout", type=float, default=5.0)
    d.add_argument("--cidr")
    d.set_defaults(func=cmd_discover)
    s = sub.add_parser("status", help="show identity, cameras, channels and spool state")
    s.set_defaults(func=cmd_status)
    pr = sub.add_parser("probe", help="diagnose a stream: decode a bounded sample and report readiness")
    pr.add_argument("--source", required=True)
    pr.add_argument("--username")
    pr.set_defaults(func=cmd_probe)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        cfg_level = os.environ.get("RETAILGUARD_EDGE_LOG_LEVEL", "INFO")
        configure_logging(cfg_level, args.log_file or os.environ.get("RETAILGUARD_EDGE_LOG_FILE"))
        return args.func(args)
    except ConfigError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
