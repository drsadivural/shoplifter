#!/usr/bin/env bash
# Install or update the RetailGuard edge appliance software (Debian/Ubuntu, run as root).
#
#   git clone https://github.com/drsadivural/shoplifter.git
#   sudo bash shoplifter/services/edge/deploy/install.sh --api https://shoplifter.ayonix.com [--mode streaming|full]
#
# Installs ffmpeg and uv, a private Python 3.12 and the locked dependencies under
# /opt/retailguard-edge, the config (/etc/retailguard-edge/config.toml, kept on updates), the
# hardened systemd unit, and a `retailguard-edge` command that runs as the service user.
set -euo pipefail

API=""
MODE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --api) API="${2:?--api needs a URL}"; shift 2 ;;
    --mode)
      MODE="${2:?--mode needs streaming or full}"; shift 2
      case "$MODE" in streaming|full) ;; *) echo "--mode must be streaming or full" >&2; exit 2 ;; esac ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo bash $0 ...)" >&2; exit 1; }

SRC="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX=/opt/retailguard-edge
ETC=/etc/retailguard-edge
STATE=/var/lib/retailguard-edge
SVC_USER=retailguard-edge

echo "==> System packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg curl ca-certificates rsync >/dev/null

echo "==> Service user"
id -u "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$STATE" --shell /usr/sbin/nologin "$SVC_USER"
getent group video >/dev/null && usermod -aG video "$SVC_USER"   # USB cameras

if ! command -v uv >/dev/null 2>&1; then
  echo "==> uv"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh
fi

echo "==> Application"
mkdir -p "$PREFIX" "$ETC"
rsync -a --delete --exclude .venv --exclude python --exclude tests --exclude __pycache__ "$SRC"/ "$PREFIX"/
cd "$PREFIX"
# Interpreter under /opt so the hardened unit (ProtectHome=yes) can reach it.
UV_PYTHON_INSTALL_DIR="$PREFIX/python" uv python install 3.12
UV_PYTHON_INSTALL_DIR="$PREFIX/python" uv sync --frozen --no-dev
install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$STATE"

if [ ! -f "$ETC/config.toml" ]; then
  cp deploy/config.example.toml "$ETC/config.toml"
  if [ -n "$API" ]; then sed -i "s#^api_base_url = .*#api_base_url = \"$API\"#" "$ETC/config.toml"; fi
  if [ -n "$MODE" ]; then sed -i "s#^processing_mode = .*#processing_mode = \"$MODE\"#" "$ETC/config.toml"; fi
fi
chown root:"$SVC_USER" "$ETC/config.toml"
chmod 0640 "$ETC/config.toml"

install -m 0644 deploy/retailguard-edge.service /etc/systemd/system/retailguard-edge.service
cat > /usr/local/bin/retailguard-edge <<WRAP
#!/bin/sh
# RetailGuard edge CLI, run as the service user with the service's config and state (root only).
exec runuser -u $SVC_USER -- env RETAILGUARD_EDGE_CONFIG=$ETC/config.toml \\
  $PREFIX/.venv/bin/retailguard-edge --state-dir $STATE "\$@"
WRAP
chmod 0755 /usr/local/bin/retailguard-edge
systemctl daemon-reload
if systemctl is-active --quiet retailguard-edge; then
  systemctl restart retailguard-edge
  echo "==> Updated and restarted."
else
  cat <<NEXT
==> Installed $(/usr/local/bin/retailguard-edge --version).
Next:
  sudo retailguard-edge pair --api ${API:-https://shoplifter.ayonix.com} --code <CODE> --name "<appliance name>"
  sudo systemctl enable --now retailguard-edge
  sudo retailguard-edge status
NEXT
fi
