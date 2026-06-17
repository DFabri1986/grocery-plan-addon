# Grocery Plan — Home Assistant add-on

Shared family meal-planner and grocery-budget tool, self-hosted as a Home
Assistant add-on. Plan meals once and the shopping list builds itself; two
people edit the same data and see each other's changes within a few seconds.
Auth is handled by Home Assistant Ingress — no separate login.

- **Backend:** Django + Django REST Framework + SQLite (`/data`) + Gunicorn,
  static served by WhiteNoise (no nginx).
- **Frontend:** React (Vite), reusing the original `grocery_planner` UI and its
  client-side grocery aggregation, with the storage layer swapped for the REST
  API.
- **Admin:** django-unfold-themed Django admin, reachable only through the
  add-on.

See [DOCS.md](DOCS.md) for installation, configuration and usage.
See [CHANGELOG.md](CHANGELOG.md) for version history.

## Architecture

```
Browser ── HA Ingress (/api/hassio_ingress/<token>/) ──► Gunicorn :8099
                                                          │
                                React SPA (WhiteNoise) ◄──┤  "/", "/assets/..."
                                Django REST API       ◄──┤  "/api/..."
                                Django admin (unfold) ◄──┘  "/admin/..."
                                              │
                                          SQLite in /data
```

All asset and API URLs are relative / derived from `window.location`, and the
server maps `X-Ingress-Path` onto the WSGI `SCRIPT_NAME`, so both the SPA and
the admin work behind Ingress's random base path.
