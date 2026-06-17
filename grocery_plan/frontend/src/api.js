/* ------------------------------------------------------------------ *
 *  api.js — REST sync layer for the Grocery Plan add-on.
 *
 *  Replaces the old window.storage load/save. Loads the whole shared
 *  state from the Django backend, polls for other people's changes, and
 *  pushes granular CRUD calls when this user edits something.
 *
 *  Works behind Home Assistant Ingress (/api/hassio_ingress/<token>/):
 *  all URLs are derived from window.location, so they hit the
 *  ingress-prefixed path. Assets use relative Vite paths (base: './').
 * ------------------------------------------------------------------ */
import { useCallback, useEffect, useRef, useState } from "react";
import { applyIdMap, clone, deepEqual, hasIdMap, num, pushDiff } from "./sync.js";

/* ---------- shared helpers (moved out of the component) ---------- */
let CURRENCY = "$";
export const setCurrency = (c) => { if (c) CURRENCY = c; };
export const money = (n) => CURRENCY + (Number(n) || 0).toFixed(2);
export { num };
export const uid = () => "tmp_" + Math.random().toString(36).slice(2, 9);

/* ---------- URL handling for Ingress ---------- */
function basePath() {
  // e.g. "/api/hassio_ingress/<token>/" — ensure a trailing slash so the
  // relative API path resolves under the ingress base, not a sibling.
  let p = window.location.pathname;
  if (!p.endsWith("/")) p += "/";
  return p;
}
const apiUrl = (path) => basePath() + "api/" + path;

async function api(path, method = "GET", body) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ---------- empty/initial state ---------- */
const EMPTY = {
  budget: 0, period: "Week", priceBook: [], meals: [], week: {},
  nonFood: [], extras: [], actuals: {}, got: {},
};

const isEditing = () => ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);

/* ================================================================== *
 *  useSyncedData — the hook the component uses instead of useState.
 * ================================================================== */
export function useSyncedData() {
  const [data, setDataState] = useState(null);
  const [status, setStatus] = useState("loading"); // loading|saved|saving|offline

  const dataRef = useRef(null);
  const lastSynced = useRef(clone(EMPTY));
  const syncing = useRef(false);
  const dirty = useRef(false);
  const debounce = useRef(null);
  const pollMs = useRef(3000);

  const setData = useCallback((updater) => {
    setDataState((cur) => {
      const next = typeof updater === "function" ? updater(cur) : updater;
      dataRef.current = next;
      return next;
    });
  }, []);

  // initial load: config + state
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await api("config/");
        if (cfg) { setCurrency(cfg.currency); pollMs.current = Math.max(1, cfg.pollInterval || 3) * 1000; }
      } catch { /* fall back to defaults */ }
      try {
        const st = await api("state/");
        if (!alive) return;
        lastSynced.current = clone(st);
        dataRef.current = st;
        setDataState(st);
        setStatus("saved");
      } catch {
        if (!alive) return;
        setStatus("offline");
      }
    })();
    return () => { alive = false; };
  }, []);

  // push local edits (debounced diff against last server snapshot)
  const runSync = useCallback(async () => {
    if (syncing.current) return;
    const next = dataRef.current;
    if (!next || deepEqual(lastSynced.current, next)) { dirty.current = false; return; }
    syncing.current = true;
    setStatus("saving");
    try {
      const snapshot = clone(next);
      const idMap = await pushDiff(api, lastSynced.current, snapshot);
      const synced = hasIdMap(idMap) ? applyIdMap(snapshot, idMap) : snapshot;
      lastSynced.current = synced;
      if (hasIdMap(idMap)) setData((cur) => (cur ? applyIdMap(cur, idMap) : cur));
      dirty.current = false;
      setStatus("saved");
    } catch (e) {
      console.error("sync failed", e);
      setStatus("offline");
    } finally {
      syncing.current = false;
      // edits arrived mid-sync? go again.
      if (dataRef.current && !deepEqual(lastSynced.current, dataRef.current)) scheduleSync();
    }
  }, [setData]);

  const scheduleSync = useCallback(() => {
    dirty.current = true;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(runSync, 450);
  }, [runSync]);

  // watch data changes
  useEffect(() => {
    if (data == null) return;
    if (deepEqual(lastSynced.current, data)) return;
    scheduleSync();
  }, [data, scheduleSync]);

  // poll for other users' changes
  useEffect(() => {
    let timer;
    const tick = async () => {
      timer = setTimeout(tick, pollMs.current);
      if (syncing.current || dirty.current) return;        // local writes pending
      if (isEditing()) return;                              // don't clobber active input
      if (dataRef.current && !deepEqual(lastSynced.current, dataRef.current)) return;
      try {
        const st = await api("state/");
        if (!deepEqual(st, lastSynced.current) && !isEditing() && !dirty.current) {
          lastSynced.current = clone(st);
          dataRef.current = st;
          setDataState(st);
          setStatus("saved");
        }
      } catch { setStatus("offline"); }
    };
    timer = setTimeout(tick, pollMs.current);
    return () => clearTimeout(timer);
  }, []);

  // manual reload from server (discard local view)
  const reload = useCallback(async () => {
    try {
      const st = await api("state/");
      lastSynced.current = clone(st);
      dataRef.current = st;
      setDataState(st);
      setStatus("saved");
    } catch { setStatus("offline"); }
  }, []);

  return { data, setData, status, reload };
}
