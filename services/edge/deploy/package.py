"""Build the customer packages for the edge software.

    python3 deploy/package.py [--out DIR]

dist/retailguard-edge-<version>-linux.tar.gz  (install with deploy/install.sh)
dist/retailguard-edge-<version>-windows.zip   (install with deploy/install-windows.ps1)
plus SHA256SUMS. Both contain the same source and lock file; tests and local environments are left out.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import tarfile
import time
import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LICENSE = ROOT.parent.parent / "LICENSE"
SKIP_DIRS = {".venv", "tests", "__pycache__", ".pytest_cache", "dist", ".ruff_cache", ".mypy_cache"}
SKIP_PREFIXES = ("deploy/windows/",)  # setup wizard sources and artwork: built into AyonixRetailGuardSetup.exe
SKIP_FILES = {".gitignore", "deploy/package.py"}
# Left out of the other platform's package (each package gets its own guide as INSTALL.txt).
WINDOWS_FILES = {"deploy/install-windows.ps1", "deploy/uninstall-windows.ps1", "deploy/INSTALL-windows.txt"}
LINUX_FILES = {"deploy/install.sh", "deploy/retailguard-edge.service", "deploy/INSTALL-linux.txt"}


def files() -> list[str]:
    out = []
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT)
        if (p.is_dir() or any(part in SKIP_DIRS for part in rel.parts) or p.suffix == ".pyc"
                or rel.as_posix() in SKIP_FILES or rel.as_posix().startswith(SKIP_PREFIXES)):
            continue
        out.append(rel.as_posix())
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "dist"))
    args = ap.parse_args()
    version = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    top = f"retailguard-edge-{version}"
    all_files = files()
    mtime = int(time.time())

    linux = out / f"{top}-linux.tar.gz"
    with tarfile.open(linux, "w:gz") as tar:
        for rel in all_files:
            if rel in WINDOWS_FILES or rel == "deploy/INSTALL-linux.txt":
                continue
            info = tar.gettarinfo(str(ROOT / rel), f"{top}/{rel}")
            info.uid = info.gid = 0
            info.uname = info.gname = "root"
            info.mode = 0o755 if rel.endswith(".sh") else 0o644
            with open(ROOT / rel, "rb") as fh:
                tar.addfile(info, fh)
        if LICENSE.exists():
            tar.add(str(LICENSE), f"{top}/LICENSE")
        data = (ROOT / "deploy/INSTALL-linux.txt").read_bytes().replace(b"VERSION", version.encode())
        info = tarfile.TarInfo(f"{top}/INSTALL.txt")
        info.size, info.mode, info.mtime = len(data), 0o644, mtime
        tar.addfile(info, io.BytesIO(data))

    windows = out / f"{top}-windows.zip"
    with zipfile.ZipFile(windows, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel in all_files:
            if rel in LINUX_FILES or rel == "deploy/INSTALL-windows.txt":
                continue
            zf.write(ROOT / rel, f"{top}/{rel}")
        if LICENSE.exists():
            zf.write(LICENSE, f"{top}/LICENSE")
        data = (ROOT / "deploy/INSTALL-windows.txt").read_text("utf-8").replace("VERSION", version)
        # UTF-8 BOM + CRLF so Notepad on any Windows version shows the Japanese text correctly.
        zf.writestr(f"{top}/INSTALL.txt", "\ufeff" + data.replace("\r\n", "\n").replace("\n", "\r\n"))

    sums = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in (linux, windows))
    (out / "SHA256SUMS").write_text(sums)
    print(sums, end="")


if __name__ == "__main__":
    main()
