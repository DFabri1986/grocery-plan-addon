# Grocery Plan

A shared, self-hosted family meal-planner and grocery-budget tool. Plan meals
once and the shopping list builds itself. Two (or more) people on your home
network edit the **same** data and see each other's changes within a few
seconds. Authentication is handled entirely by Home Assistant Ingress — there is
no separate login.

## How it works

- A small Django + Django REST Framework backend stores everything in a SQLite
  database under `/data` (so it survives restarts/updates and is included in
  Home Assistant backups).
- The React UI loads the whole shared state in one call (`GET /api/state/`),
  then polls every few seconds for other people's edits and pushes your own
  edits as granular REST calls. Last write wins.
- The grocery list is derived from your week plan in the browser — change a
  meal or a price and every total recalculates.

## Installation

This is a **local** add-on.

1. Copy the `grocery_plan` folder into your Home Assistant `/addons` directory
   (e.g. via the *Samba share* or *Studio Code Server* / *SSH* add-ons, into
   `/addons/grocery_plan`).
2. In Home Assistant, go to **Settings → Add-ons → Add-on Store**, open the
   **⋮** menu (top-right) and choose **Check for updates** / **Reload**.
3. The **Grocery Plan** add-on appears under *Local add-ons*. Open it and click
   **Install**.
4. Click **Start**. On first start the database is created and seeded with
   example data.
5. Open it from the **Grocery Plan** entry in the sidebar (or the *Open Web UI*
   button).

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `currency_symbol` | `$` | Symbol shown in front of all money values. |
| `poll_interval` | `3` | How often (seconds) the app checks for other people's changes. 1–60. |
| `default_period` | `Week` | Budget period label used when the database is first seeded. |
| `log_level` | `info` | Add-on log verbosity (`trace`, `debug`, `info`, `notice`, `warning`, `error`, `fatal`). |

After changing options, **Restart** the add-on.

## Importing from Coles / Woolworths receipts

On the **Prices** tab, click **Import receipt** and choose one or more order PDFs
(you can select many at once). The add-on parses them, de-duplicates the items
(keeping the most recent price), guesses a category and unit, and shows
everything in a review table. Adjust or untick rows, then **Import** — existing
items update their price, new ones are added. Each item's **supplier** is set
automatically from the receipt's vendor.

## Suppliers

A supplier list (seeded with **Coles**, **Woolworths** and **Who Gives A Crap**)
lets you record where each item is bought. Pick a supplier per item on the
**Prices** tab or directly on the **Grocery Plan** (food, non-food and extras).
Add or rename suppliers in the Django admin.

## Managing your data (admin)

The Django admin — themed with django-unfold — lets you bulk-edit data and is
reachable **only through this add-on** (no separate port). Append `admin/` to
the add-on URL in your browser, i.e. open the add-on, then change the address
to end in `…/admin/`.

To create an admin user, open a terminal on the add-on (or use the *Advanced
SSH & Web Terminal* add-on) and run:

```bash
docker exec -it addon_local_grocery_plan \
  python3 /app/manage.py createsuperuser
```

(The container name may differ; check **Settings → Add-ons → Grocery Plan →
the *Info* tab** or `docker ps`.)

## Backups

Everything is stored in `/data` inside the add-on, which Home Assistant captures
in full and partial backups automatically. Restoring a backup restores all your
meals, prices, plan and shopping state.

## Resetting to the example data

Stop the add-on, delete `db.sqlite3` from the add-on's `/data` directory, then
start it again — it will re-seed the example data.
