# Grocery Plan — self-hosted family grocery planner (Home Assistant add-on)

This repo turns the original single-file React grocery planner
(`grocery_planner.jsx`) into a self-hosted, **shared**, near-real-time family
tool, packaged as a local Home Assistant add-on.

Two people on your home network edit the **same** data and see each other's
changes within a few seconds. There is no app login — Home Assistant Ingress
handles authentication.

## Repo layout

```
.
├── grocery_planner.jsx        # the original React component (kept for reference)
├── grocery_plan/              # the Home Assistant add-on (copy THIS into /addons)
│   ├── config.yaml            # add-on metadata, ingress, options schema
│   ├── Dockerfile             # multi-stage: build React → Django runtime
│                              #   (base image set here; build.yaml is deprecated)
│   ├── run.sh                 # bashio startup: migrate → seed → gunicorn
│   ├── icon.png / logo.png    # add-on artwork (placeholders)
│   ├── README.md / DOCS.md / CHANGELOG.md
│   ├── app/                   # Django project (DRF API, admin, models, seed)
│   │   ├── groceryproj/        # settings, urls, wsgi, ingress helpers
│   │   └── planner/            # models, serializers, views, admin, seed
│   └── frontend/              # React (Vite) source — adapted from grocery_planner.jsx
│       └── src/{api.js, GroceryPlanner.jsx, main.jsx, index.css}
└── README.md                  # this file
```

The React **source** lives in `grocery_plan/frontend/`; the Dockerfile builds it
and copies the output into the image, so `docker build` is self-contained.

## Install it in Home Assistant

1. **Copy** the `grocery_plan` folder into your Home Assistant `/addons`
   directory so you end up with `/addons/grocery_plan/config.yaml`. Easiest
   ways to get a file into `/addons`:
   - the **Samba share** add-on (a `addons` network share appears), or
   - the **Studio Code Server** / **Advanced SSH & Web Terminal** add-on, then
     copy the folder under `/addons`.
2. In Home Assistant: **Settings → Add-ons → Add-on Store**, open the **⋮**
   menu (top-right) → **Check for updates** (this refreshes the local store).
3. Scroll to **Local add-ons** → open **Grocery Plan** → **Install**.
4. (Optional) set options on the **Configuration** tab (currency symbol, poll
   interval, period).
5. **Start** the add-on. First start creates and seeds the database.
6. Open it from the **Grocery Plan** entry in the sidebar.

Full usage, configuration and admin instructions: [`grocery_plan/DOCS.md`](grocery_plan/DOCS.md).

## Build / validate locally

```bash
cd grocery_plan
# The base image (a multi-arch manifest) is set in the Dockerfile, so a plain
# build picks the host architecture. To force a specific arch, add e.g.
# --platform linux/amd64.
docker build -t grocery-plan .

# Run it standalone (Ingress is simulated by the relative-path handling):
docker run --rm -p 8099:8099 -v "$PWD/_data:/data" grocery-plan
# then open http://localhost:8099/
```

### Validate the add-on config

The Supervisor validates `config.yaml` against its schema at install time. To
test it the canonical way, use the official
[add-on devcontainer / example repo](https://github.com/home-assistant/addons-example)
(adds your folder as a *Local add-on* and builds it in a real Supervisor), or
simply drop the folder into `/addons` on a live instance — invalid keys surface
as install errors. A plain YAML linter catches syntax issues:

```bash
yamllint grocery_plan/config.yaml
```

## How the shared, near-real-time sync works

- On load the app fetches the whole state in one call: `GET /api/state/`.
- A poll (default every 3s; `poll_interval` option) re-fetches and reconciles —
  but it never clobbers a field while you're typing (it skips while an input is
  focused and while you have unsaved local edits).
- Every edit optimistically updates the UI and is pushed as a granular
  `POST/PATCH/DELETE` to the matching entity (with bulk endpoints for the week
  plan and the shop ticks/amounts). Last write wins.
