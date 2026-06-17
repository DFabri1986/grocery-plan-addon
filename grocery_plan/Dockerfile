# syntax=docker/dockerfile:1

# BUILD_FROM is provided per-arch by the Home Assistant builder (build.yaml).
# It MUST be declared as a global ARG — before the first FROM — so it is in
# scope for the runtime FROM in stage 2 of this multi-stage build. The default
# lets `docker build` succeed standalone (e.g. for amd64 CI).
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base-python:3.13-alpine3.24

# ---------------------------------------------------------------------------
# Stage 1 — build the React (Vite) frontend
# ---------------------------------------------------------------------------
FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — Django runtime on the Home Assistant Python base image
# ---------------------------------------------------------------------------
FROM ${BUILD_FROM}

ENV LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DJANGO_SETTINGS_MODULE=groceryproj.settings \
    DATA_DIR=/data \
    FRONTEND_DIST=/app/frontend_dist \
    SECRET_KEY=build-time-only

WORKDIR /app

# Python dependencies (all pure-Python wheels; no build toolchain needed).
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Django project + built frontend.
COPY app/ /app/
COPY --from=frontend /build/dist /app/frontend_dist

# Collect admin/unfold/DRF static files for WhiteNoise (writes to /app/staticfiles).
RUN python3 manage.py collectstatic --noinput

# Startup script.
COPY run.sh /run.sh
RUN chmod a+x /run.sh

LABEL \
    io.hass.type="addon" \
    io.hass.name="Grocery Plan"

CMD [ "/run.sh" ]
