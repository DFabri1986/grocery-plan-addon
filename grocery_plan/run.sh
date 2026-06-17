#!/usr/bin/with-contenv bashio
# ---------------------------------------------------------------------------
# Grocery Plan add-on startup:
#   1. read add-on options via bashio
#   2. migrate the SQLite DB (in /data)
#   3. seed example data only if the DB is empty
#   4. start Gunicorn bound to the ingress port
# ---------------------------------------------------------------------------
set -e

# ---- read user-tunable options ----
export CURRENCY_SYMBOL="$(bashio::config 'currency_symbol')"
export POLL_INTERVAL="$(bashio::config 'poll_interval')"
export DEFAULT_PERIOD="$(bashio::config 'default_period')"
LOG_LEVEL="$(bashio::config 'log_level')"

# Map the add-on log level onto Django/Python logging levels.
case "${LOG_LEVEL}" in
  trace|debug)   export DJANGO_LOG_LEVEL="DEBUG" ;;
  notice|warning) export DJANGO_LOG_LEVEL="WARNING" ;;
  error)         export DJANGO_LOG_LEVEL="ERROR" ;;
  fatal)         export DJANGO_LOG_LEVEL="CRITICAL" ;;
  *)             export DJANGO_LOG_LEVEL="INFO" ;;
esac

export DATA_DIR="/data"
export FRONTEND_DIST="/app/frontend_dist"
export DJANGO_SETTINGS_MODULE="groceryproj.settings"
# Unset the build-time placeholder so settings generates/loads /data/secret_key.
unset SECRET_KEY

cd /app

bashio::log.info "Applying database migrations..."
python3 manage.py migrate --noinput

bashio::log.info "Seeding example data if the database is empty..."
python3 manage.py seed_if_empty

bashio::log.info "Starting Grocery Plan (Gunicorn) on ingress port 8099..."
# exec so Gunicorn becomes PID 1's child target and receives SIGTERM directly,
# letting Home Assistant stop the add-on cleanly.
exec gunicorn groceryproj.wsgi:application \
  --bind "0.0.0.0:8099" \
  --workers 2 \
  --timeout 60 \
  --graceful-timeout 20 \
  --access-logfile - \
  --error-logfile -
