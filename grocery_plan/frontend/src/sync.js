/* ------------------------------------------------------------------ *
 *  sync.js — pure sync logic (no React, no window/fetch).
 *
 *  All I/O is injected as an `api(path, method, body)` function, so this
 *  module can be unit-tested in isolation against a real or fake server.
 * ------------------------------------------------------------------ */

export const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

/* order-insensitive deep equality */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => deepEqual(v, b[i]));
    }
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

export const clone = (x) => JSON.parse(JSON.stringify(x));
export const hasIdMap = (m) => Object.values(m).some((kv) => Object.keys(kv).length);

/* Diff `prev` against `next` and push granular API calls via `api`.
 * Returns a tmp->real id map per entity kind. */
export async function pushDiff(api, prev, next) {
  const idMap = { price: {}, meal: {}, nonfood: {}, extra: {}, person: {}, week: {} };
  const tr = (kind, id) => (idMap[kind][id] != null ? idMap[kind][id] : id);

  if (!deepEqual(prev.budget, next.budget) || prev.period !== next.period) {
    await api("settings/", "PATCH", { budget: next.budget, period: next.period });
  }

  const byId = (arr) => Object.fromEntries((arr || []).map((x) => [x.id, x]));

  {
    const p = byId(prev.priceBook), n = byId(next.priceBook);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`prices/${id}/`, "DELETE");
    for (const it of next.priceBook) {
      const payload = { item: it.item, price: num(it.price), unit: it.unit, category: it.category, isFood: !!it.isFood, supplierId: it.supplierId ?? null };
      if (!(it.id in p)) { const r = await api("prices/", "POST", payload); if (r) idMap.price[it.id] = String(r.id); }
      else if (!deepEqual(p[it.id], it)) await api(`prices/${it.id}/`, "PATCH", payload);
    }
  }

  {
    const p = byId(prev.meals), n = byId(next.meals);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`meals/${id}/`, "DELETE");
    for (const m of next.meals) {
      const payload = { name: m.name, mealTime: m.mealTime, items: (m.items || []).map((it) => ({ itemId: tr("price", it.itemId), qty: num(it.qty) })) };
      if (!(m.id in p)) { const r = await api("meals/", "POST", payload); if (r) idMap.meal[m.id] = String(r.id); }
      else if (!deepEqual(p[m.id], m)) await api(`meals/${m.id}/`, "PATCH", payload);
    }
  }

  {
    const p = byId(prev.nonFood), n = byId(next.nonFood);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`nonfood/${id}/`, "DELETE");
    for (const r0 of next.nonFood) {
      const payload = { itemId: tr("price", r0.itemId), qty: num(r0.qty) };
      if (!(r0.id in p)) { const r = await api("nonfood/", "POST", payload); if (r) idMap.nonfood[r0.id] = String(r.id); }
      else if (!deepEqual(p[r0.id], r0)) await api(`nonfood/${r0.id}/`, "PATCH", payload);
    }
  }

  {
    const p = byId(prev.extras), n = byId(next.extras);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`extras/${id}/`, "DELETE");
    for (const e of next.extras) {
      const payload = { item: e.item, qty: num(e.qty), price: num(e.price), supplierId: e.supplierId ?? null };
      if (!(e.id in p)) { const r = await api("extras/", "POST", payload); if (r) idMap.extra[e.id] = String(r.id); }
      else if (!deepEqual(p[e.id], e)) await api(`extras/${e.id}/`, "PATCH", payload);
    }
  }

  // people
  {
    const p = byId(prev.people), n = byId(next.people);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`people/${id}/`, "DELETE");
    for (const pe of next.people) {
      const payload = { name: pe.name, order: num(pe.order) };
      if (!(pe.id in p)) { const r = await api("people/", "POST", payload); if (r) idMap.person[pe.id] = String(r.id); }
      else if (!deepEqual(p[pe.id], pe)) await api(`people/${pe.id}/`, "PATCH", payload);
    }
  }

  // weeks (personId may be a freshly-created tmp id -> translate)
  {
    const p = byId(prev.weeks), n = byId(next.weeks);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`weeks/${id}/`, "DELETE");
    for (const w of next.weeks) {
      const payload = { personId: tr("person", w.personId), weekStart: w.weekStart };
      if (!(w.id in p)) { const r = await api("weeks/", "POST", payload); if (r) idMap.week[w.id] = String(r.id); }
      // weekStart/personId are immutable in the UI; no PATCH path needed.
    }
  }

  // plans: PUT the grid for any week whose grid changed (translate week + meal ids)
  for (const weekId of Object.keys(next.plans || {})) {
    const before = (prev.plans || {})[weekId];
    const after = next.plans[weekId];
    if (deepEqual(before, after)) continue;
    const grid = {};
    for (const day of Object.keys(after)) {
      grid[day] = {};
      for (const mt of Object.keys(after[day])) {
        grid[day][mt] = (after[day][mt] || []).map((mid) => tr("meal", mid));
      }
    }
    await api(`weeks/${tr("week", weekId)}/plan/`, "PUT", grid);
  }

  // shop: PUT per calendar week whose actuals/got changed
  {
    const weekStarts = new Set([...Object.keys(prev.shop || {}), ...Object.keys(next.shop || {})]);
    const trKey = (k) => {
      const pfx = k.slice(0, 2), id = k.slice(2);
      if (pfx === "f_") return "f_" + tr("price", id);
      if (pfx === "n_") return "n_" + tr("nonfood", id);
      if (pfx === "x_") return "x_" + tr("extra", id);
      return k;
    };
    const mapKeys = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [trKey(k), v]));
    for (const ws of weekStarts) {
      const before = (prev.shop || {})[ws];
      const after = (next.shop || {})[ws] || { actuals: {}, got: {} };
      if (deepEqual(before, after)) continue;
      await api("shop/", "PUT", { weekStart: ws, actuals: mapKeys(after.actuals), got: mapKeys(after.got) });
    }
  }

  return idMap;
}

/* Apply a tmp->real id map to a local state object (preserving edits). */
export function applyIdMap(d, idMap) {
  const tr = (kind, id) => (idMap[kind][id] != null ? idMap[kind][id] : id);
  const trKey = (k) => {
    const pfx = k.slice(0, 2), id = k.slice(2);
    if (pfx === "f_") return "f_" + tr("price", id);
    if (pfx === "n_") return "n_" + tr("nonfood", id);
    if (pfx === "x_") return "x_" + tr("extra", id);
    return k;
  };
  const remapMap = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [trKey(k), v]));
  return {
    ...d,
    priceBook: d.priceBook.map((p) => ({ ...p, id: tr("price", p.id) })),
    meals: d.meals.map((m) => ({
      ...m, id: tr("meal", m.id),
      items: (m.items || []).map((it) => ({ ...it, itemId: tr("price", it.itemId) })),
    })),
    nonFood: d.nonFood.map((r) => ({ ...r, id: tr("nonfood", r.id), itemId: tr("price", r.itemId) })),
    extras: d.extras.map((e) => ({ ...e, id: tr("extra", e.id) })),
    people: (d.people || []).map((pe) => ({ ...pe, id: tr("person", pe.id) })),
    weeks: (d.weeks || []).map((w) => ({ ...w, id: tr("week", w.id), personId: tr("person", w.personId) })),
    plans: Object.fromEntries(Object.entries(d.plans || {}).map(([wid, grid]) => [
      tr("week", wid),
      Object.fromEntries(Object.entries(grid).map(([day, slots]) => [
        day, Object.fromEntries(Object.entries(slots).map(([mt, ids]) => [mt, ids.map((id) => tr("meal", id))])),
      ])),
    ])),
    shop: Object.fromEntries(Object.entries(d.shop || {}).map(([ws, b]) => [
      ws, { actuals: remapMap(b.actuals || {}), got: remapMap(b.got || {}) },
    ])),
  };
}
