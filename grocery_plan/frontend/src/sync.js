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
  const idMap = { price: {}, meal: {}, nonfood: {}, extra: {} };
  const tr = (kind, id) => (idMap[kind][id] != null ? idMap[kind][id] : id);

  if (!deepEqual(prev.budget, next.budget) || prev.period !== next.period) {
    await api("settings/", "PATCH", { budget: next.budget, period: next.period });
  }

  const byId = (arr) => Object.fromEntries((arr || []).map((x) => [x.id, x]));

  {
    const p = byId(prev.priceBook), n = byId(next.priceBook);
    for (const id of Object.keys(p)) if (!(id in n)) await api(`prices/${id}/`, "DELETE");
    for (const it of next.priceBook) {
      const payload = { item: it.item, price: num(it.price), unit: it.unit, category: it.category, isFood: !!it.isFood };
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
      const payload = { item: e.item, qty: num(e.qty), price: num(e.price) };
      if (!(e.id in p)) { const r = await api("extras/", "POST", payload); if (r) idMap.extra[e.id] = String(r.id); }
      else if (!deepEqual(p[e.id], e)) await api(`extras/${e.id}/`, "PATCH", payload);
    }
  }

  if (!deepEqual(prev.week, next.week)) {
    const week = {};
    for (const day of Object.keys(next.week)) {
      week[day] = {};
      for (const mt of Object.keys(next.week[day])) {
        week[day][mt] = (next.week[day][mt] || []).map((mid) => tr("meal", mid));
      }
    }
    await api("week/", "PUT", week);
  }

  if (!deepEqual(prev.actuals, next.actuals) || !deepEqual(prev.got, next.got)) {
    const trKey = (k) => {
      const pfx = k.slice(0, 2), id = k.slice(2);
      if (pfx === "f_") return "f_" + tr("price", id);
      if (pfx === "n_") return "n_" + tr("nonfood", id);
      if (pfx === "x_") return "x_" + tr("extra", id);
      return k;
    };
    const mapKeys = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [trKey(k), v]));
    await api("shop/", "PUT", { actuals: mapKeys(next.actuals), got: mapKeys(next.got) });
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
    week: Object.fromEntries(Object.entries(d.week).map(([day, slots]) => [
      day, Object.fromEntries(Object.entries(slots).map(([mt, ids]) => [mt, ids.map((id) => tr("meal", id))])),
    ])),
    actuals: remapMap(d.actuals),
    got: remapMap(d.got),
  };
}
