#!/usr/bin/env bash
# Build and deploy RetailGuard on this host (shoplifter.ayonix.com).
#   infra/deploy.sh            build images + web, run migrations, restart API/worker, publish web
# Requires: docker compose, node/npm, sudo, Caddy with /etc/caddy/Caddyfile importing infra/caddy/shoplifter.caddy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE=/etc/retailguard/retailguard.env
WEB_ROOT=/srv/retailguard/web
# Deploy exactly the committed HEAD (uncommitted work in the checkout is never shipped).
VERSION="$(git -C "$ROOT" rev-parse --short=12 HEAD)"
export RG_VERSION="$VERSION"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
git -C "$ROOT" archive HEAD | tar -x -C "$BUILD"

echo "==> Building API image retailguard-api:$VERSION"
docker build -q -t "retailguard-api:$VERSION" "$BUILD/services/api"

echo "==> Building web console"
(cd "$BUILD/apps/web" && npm ci --no-audit --no-fund && npm run build)

echo "==> Starting database, migrating, restarting services"
sudo RG_VERSION="$VERSION" docker compose -f "$ROOT/infra/docker-compose.prod.yml" --env-file "$ENV_FILE" up -d --remove-orphans

echo "==> Publishing web build"
sudo mkdir -p "$WEB_ROOT.new"
sudo rsync -a --delete "$BUILD/apps/web/dist/" "$WEB_ROOT.new/"
sudo rm -rf "$WEB_ROOT.prev"
[ -d "$WEB_ROOT" ] && sudo mv "$WEB_ROOT" "$WEB_ROOT.prev"
sudo mv "$WEB_ROOT.new" "$WEB_ROOT"

echo "==> Reloading Caddy"
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
sudo systemctl reload caddy

echo "==> Waiting for API health"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8720/readyz >/dev/null; then echo "API ready ($VERSION)"; exit 0; fi
  sleep 2
done
echo "API did not become ready" >&2
exit 1
