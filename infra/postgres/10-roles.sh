#!/bin/sh
# Creates the database roles used by RetailGuard. Runs once on first container start.
#  retailguard_owner  - migration identity / table owner (BYPASSRLS, used only by `migrate`/`bootstrap`)
#  retailguard_app    - API runtime role (subject to row level security)
#  retailguard_worker - background worker role (cross-tenant outbox/retention processing)
set -eu
: "${RG_OWNER_PASSWORD:?}" "${RG_APP_PASSWORD:?}" "${RG_WORKER_PASSWORD:?}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$RG_OWNER_PASSWORD" -v app_pw="$RG_APP_PASSWORD" -v worker_pw="$RG_WORKER_PASSWORD" <<'SQL'
CREATE ROLE retailguard_owner LOGIN BYPASSRLS PASSWORD :'owner_pw';
CREATE ROLE retailguard_app LOGIN NOBYPASSRLS PASSWORD :'app_pw';
CREATE ROLE retailguard_worker LOGIN BYPASSRLS PASSWORD :'worker_pw';
CREATE DATABASE retailguard OWNER retailguard_owner;
\c retailguard
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO retailguard_owner;
GRANT USAGE ON SCHEMA public TO retailguard_app, retailguard_worker;
SQL
