import React, { useState, useMemo, useRef } from "react";
import {
  Plus, Trash2, Check, Copy, RotateCcw, ChevronDown, ChevronRight,
  CalendarDays, ShoppingCart, BookOpen, Tag, X, CheckCircle2, Upload, RefreshCw, Store, Layers,
} from "lucide-react";
import { money, num, uid, useSyncedData, parseReceipts, commitImport, lookupPrice, dedupePrices } from "./api";

/* ---------- palette + type ---------- */
const C = {
  dark: "#1B5E43", mid: "#2E7D5B", blue: "#4F6F9C", amber: "#B5722A",
  light: "#EAF3EE", band: "#F4F8F5", yellow: "#FFF4CC", line: "#D6DED8",
  red: "#C0392B", redbg: "#F9D7D3", ok: "#1B7A3D", ink: "#1E2328", sub: "#5A655F",
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SCHOOL = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const MEALTIMES = ["Breakfast", "Recess", "Lunch", "Dinner", "Snacks"];
const CATEGORIES = [
  "Fresh Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Pantry & Dry",
  "Frozen", "Drinks", "Snacks & Treats", "Household", "Health & Personal",
  "Baby & Kids", "Pet",
];

/* ---------- shopping-unit rounding ----------
   You can't buy 2.7 loaves, so aggregated shopping quantities round UP — except
   for loose weight/volume units (kg, g, L…), where a fraction is fine. */
const DIVISIBLE_UNITS = new Set([
  "kg", "kgs", "g", "gram", "grams", "kilogram", "kilograms",
  "l", "ml", "litre", "litres", "liter", "liters",
]);
const isDivisibleUnit = (u) => DIVISIBLE_UNITS.has(String(u || "").trim().toLowerCase());
const roundQty = (q, unit) => (isDivisibleUnit(unit) ? q : Math.ceil(q - 1e-9));

/* ---------- small UI helpers ---------- */
const Btn = ({ children, onClick, tone = "ghost", title, style }) => {
  const tones = {
    solid: { background: C.dark, color: "#fff", border: `1px solid ${C.dark}` },
    ghost: { background: "#fff", color: C.dark, border: `1px solid ${C.line}` },
    danger: { background: "#fff", color: C.red, border: `1px solid ${C.line}` },
  };
  return (
    <button onClick={onClick} title={title}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors hover:opacity-90"
      style={{ ...tones[tone], ...style }}>{children}</button>
  );
};
const Money = ({ v, bold, color }) => (
  <span style={{ fontFamily: MONO, fontWeight: bold ? 700 : 500, color: color || C.ink }}>{money(v)}</span>
);
// Money input that always displays 2 decimal places when not being edited.
function PriceInput({ value, onCommit, className, style }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const display = editing ? text : (Number(value) || 0).toFixed(2);
  return (
    <input value={display} inputMode="decimal" className={className} style={style}
      onFocus={() => { setText(value === "" || value == null ? "" : String(value)); setEditing(true); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { setEditing(false); onCommit(num(text)); }} />
  );
}
const SupplierSelect = ({ suppliers, value, onChange }) => (
  <select value={value || ""} onChange={(e) => onChange(e.target.value || null)}
    className="rounded outline-none bg-transparent text-xs"
    style={{ border: `1px solid ${C.line}`, color: C.dark, padding: "2px 4px", maxWidth: 130 }}>
    <option value="">—</option>
    {(suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
  </select>
);

/* ============================================================= */
export default function GroceryPlanner() {
  const { data, setData, status, reload } = useSyncedData();
  const [tab, setTab] = useState("week");
  const [copied, setCopied] = useState(false);

  const patch = (p) => setData((d) => ({ ...d, ...p }));

  /* ---- derive grocery list from week plan ---- */
  const derived = useMemo(() => {
    if (!data) return { list: [], byMeal: {}, total: 0 };
    const map = {};
    const byMeal = { Breakfast: 0, Recess: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
    // Pass 1: aggregate the raw (fractional) quantity per item, tracking how
    // much each meal time contributes so we can split the cost afterwards.
    DAYS.forEach((day) => MEALTIMES.forEach((mt) => {
      (data.week[day]?.[mt] || []).forEach((mealId) => {
        const meal = data.meals.find((m) => m.id === mealId);
        if (!meal) return;
        meal.items.forEach((ing) => {
          const pb = data.priceBook.find((p) => p.id === ing.itemId);
          if (!pb || !pb.isFood) return;
          const q = num(ing.qty);
          if (!map[pb.id]) map[pb.id] = { id: pb.id, item: pb.item, category: pb.category, unit: pb.unit, price: num(pb.price), rawQty: 0, timeQty: {}, times: {} };
          map[pb.id].rawQty += q;
          map[pb.id].timeQty[mt] = (map[pb.id].timeQty[mt] || 0) + q;
          map[pb.id].times[mt] = true;
        });
      });
    }));
    // Pass 2: round the shopping quantity up to whole units (except loose
    // weight/volume units), recompute cost on the rounded quantity, and
    // attribute that cost back to each meal time in proportion to its share.
    const list = Object.values(map).map((x) => {
      const qty = roundQty(x.rawQty, x.unit);
      const cost = qty * x.price;
      if (x.rawQty > 0) {
        MEALTIMES.forEach((mt) => {
          if (x.timeQty[mt]) byMeal[mt] += cost * (x.timeQty[mt] / x.rawQty);
        });
      }
      return { id: x.id, item: x.item, category: x.category, unit: x.unit, qty, cost, times: MEALTIMES.filter((t) => x.times[t]) };
    }).sort((a, b) => a.category.localeCompare(b.category) || a.item.localeCompare(b.item));
    return { list, byMeal, total: list.reduce((s, x) => s + x.cost, 0) };
  }, [data]);

  const nonFoodRows = useMemo(() => {
    if (!data) return [];
    return data.nonFood.map((r) => {
      const pb = data.priceBook.find((p) => p.id === r.itemId);
      return { ...r, item: pb?.item || "—", category: pb?.category || "", unit: pb?.unit || "", price: pb?.price || 0, cost: num(r.qty) * num(pb?.price || 0) };
    });
  }, [data]);

  if (!data) return <div className="p-6 text-sm" style={{ color: C.sub }}>Loading your plan…</div>;

  /* ---- totals ---- */
  const foodEst = derived.total;
  const nonFoodEst = nonFoodRows.reduce((s, r) => s + r.cost, 0);
  const essEst = foodEst + nonFoodEst;
  const extrasEst = data.extras.reduce((s, e) => s + num(e.qty) * num(e.price), 0);
  const leftForExtras = num(data.budget) - essEst;
  const plannedBal = num(data.budget) - essEst - extrasEst;
  const actualSpent = Object.values(data.actuals).reduce((s, v) => s + num(v), 0);
  const actualBal = num(data.budget) - actualSpent;

  const aGet = (k) => data.actuals[k] ?? "";
  const aSet = (k, v) => patch({ actuals: { ...data.actuals, [k]: v } });
  const gGet = (k) => !!data.got[k];
  const gTog = (k) => patch({ got: { ...data.got, [k]: !data.got[k] } });

  /* ---- copy shopping list ---- */
  const copyList = () => {
    const lines = [];
    const group = (title, rows) => {
      const left = rows.filter((r) => !r.got);
      if (!left.length) return;
      lines.push(title.toUpperCase());
      left.forEach((r) => lines.push(`  [ ] ${r.label}`));
      lines.push("");
    };
    const withUnit = (n, unit) => `×${n}${unit ? " " + unit : ""}`;
    group("Food essentials", derived.list.map((r) => ({ got: gGet("f_" + r.id), label: `${r.item}  ${withUnit(+r.qty.toFixed(2), r.unit)}` })));
    group("Non-food essentials", nonFoodRows.map((r) => ({ got: gGet("n_" + r.id), label: `${r.item}  ${withUnit(+num(r.qty).toFixed(2), r.unit)}` })));
    group("Extras", data.extras.map((e) => ({ got: gGet("x_" + e.id), label: `${e.item}  ×${(+num(e.qty).toFixed(2))}` })));
    const text = `GROCERY LIST (${data.period})\n\n` + lines.join("\n");
    try { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  };

  const statusText = status === "saving" ? "Saving…" : status === "offline" ? "Offline" : "Saved";

  const tabs = [
    { k: "week", label: "Week Plan", Icon: CalendarDays },
    { k: "meals", label: "Meals", Icon: BookOpen },
    { k: "grocery", label: "Grocery Plan", Icon: ShoppingCart },
    { k: "prices", label: "Prices", Icon: Tag },
  ];

  return (
    <div style={{ background: "#fff", color: C.ink, minHeight: "100%" }} className="text-[15px]">
      {/* header */}
      <div style={{ background: C.dark }} className="px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-white font-bold tracking-tight text-xl">Grocery Plan</div>
            <div style={{ color: "#BFE0CF" }} className="text-xs">Plan meals once → the shopping list builds itself. Essentials first, extras after.</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md" style={{ background: C.yellow }}>
              <span className="text-xs font-semibold" style={{ color: C.dark }}>Budget</span>
              <PriceInput value={data.budget} onCommit={(v) => patch({ budget: v })}
                className="w-20 bg-transparent outline-none text-right font-bold"
                style={{ fontFamily: MONO, color: "#0000CC" }} />
              <span className="text-xs" style={{ color: C.sub }}>/</span>
              <input value={data.period} onChange={(e) => patch({ period: e.target.value })}
                className="w-20 bg-transparent outline-none font-semibold text-sm" style={{ color: "#0000CC" }} />
            </div>
            <span className="text-xs px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>
              {statusText}
            </span>
            <Btn tone="ghost" onClick={reload} title="Reload from server"><RotateCcw size={15} /></Btn>
          </div>
        </div>
      </div>

      {/* tabs */}
      <div className="flex flex-wrap gap-1 px-3 sm:px-6 pt-3" style={{ borderBottom: `1px solid ${C.line}` }}>
        {tabs.map(({ k, label, Icon }) => (
          <button key={k} onClick={() => setTab(k)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-md"
            style={{
              color: tab === k ? C.dark : C.sub,
              borderBottom: tab === k ? `2px solid ${C.dark}` : "2px solid transparent",
              background: tab === k ? C.light : "transparent",
            }}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      <div className="p-3 sm:p-6">
        {tab === "week" && <WeekPlan data={data} setData={setData} />}
        {tab === "meals" && <Meals data={data} setData={setData} />}
        {tab === "prices" && <Prices data={data} setData={setData} reload={reload} />}
        {tab === "grocery" && (
          <Grocery
            data={data} derived={derived} nonFoodRows={nonFoodRows}
            totals={{ foodEst, nonFoodEst, essEst, extrasEst, leftForExtras, plannedBal, actualSpent, actualBal }}
            aGet={aGet} aSet={aSet} gGet={gGet} gTog={gTog}
            setData={setData} copyList={copyList} copied={copied}
          />
        )}
      </div>
    </div>
  );
}

/* ============================================================= WEEK PLAN */
function WeekPlan({ data, setData }) {
  const mealName = (id) => data.meals.find((m) => m.id === id)?.name || "?";
  const add = (day, mt, mealId) => {
    if (!mealId) return;
    const week = structuredClone(data.week);
    week[day][mt] = [...(week[day][mt] || []), mealId];
    setData({ ...data, week });
  };
  const remove = (day, mt, idx) => {
    const week = structuredClone(data.week);
    week[day][mt].splice(idx, 1);
    setData({ ...data, week });
  };
  return (
    <div>
      <SectionTitle>Week Plan</SectionTitle>
      <p className="text-sm mb-3" style={{ color: C.sub }}>
        Drop a meal into each slot. Recess &amp; Lunch are the kids' school days (greyed on weekends).
        Whatever you put here flows straight onto the Grocery Plan.
      </p>
      <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${C.line}` }}>
        <table className="w-full border-collapse text-sm" style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th style={th(C.mid)} className="text-left w-24">Meal time</th>
              {DAYS.map((d) => <th key={d} style={th(C.mid)}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {MEALTIMES.map((mt) => (
              <tr key={mt}>
                <td style={{ ...td(), background: C.light, fontWeight: 700, color: C.dark }}>{mt}</td>
                {DAYS.map((d) => {
                  const weekendRecess = mt === "Recess" && !SCHOOL.has(d);
                  const slot = data.week[d]?.[mt] || [];
                  return (
                    <td key={d} style={{ ...td(), background: weekendRecess ? "#EEF1EF" : "#fff", verticalAlign: "top" }}>
                      {weekendRecess ? <span style={{ color: "#AAB3AE" }}>—</span> : (
                        <div className="flex flex-col gap-1">
                          {slot.map((mid, i) => (
                            <span key={i} className="inline-flex items-center justify-between gap-1 px-1.5 py-1 rounded"
                              style={{ background: C.band, border: `1px solid ${C.line}` }}>
                              <span className="truncate">{mealName(mid)}</span>
                              <button onClick={() => remove(d, mt, i)} style={{ color: C.sub }}><X size={13} /></button>
                            </span>
                          ))}
                          <select value="" onChange={(e) => { add(d, mt, e.target.value); e.target.value = ""; }}
                            className="text-xs rounded px-1 py-1 outline-none" style={{ border: `1px dashed ${C.line}`, color: C.sub }}>
                            <option value="">+ add…</option>
                            {[...data.meals].sort((a, b) => (a.mealTime === mt ? -1 : 1) - (b.mealTime === mt ? -1 : 1) || a.name.localeCompare(b.name))
                              .map((m) => <option key={m.id} value={m.id}>{m.name}{m.mealTime !== mt ? ` (${m.mealTime})` : ""}</option>)}
                          </select>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================================================= MEALS */
function Meals({ data, setData }) {
  const [open, setOpen] = useState(null);
  const foodItems = data.priceBook.filter((p) => p.isFood);
  const pbPrice = (id) => data.priceBook.find((p) => p.id === id)?.price || 0;

  const upd = (meals) => setData({ ...data, meals });
  const addMeal = () => { const m = { id: uid(), name: "New meal", mealTime: "Dinner", items: [] }; upd([...data.meals, m]); setOpen(m.id); };
  const delMeal = (id) => upd(data.meals.filter((m) => m.id !== id));
  const setMeal = (id, p) => upd(data.meals.map((m) => (m.id === id ? { ...m, ...p } : m)));
  const addIng = (id) => setMeal(id, { items: [...data.meals.find((m) => m.id === id).items, { itemId: foodItems[0]?.id, qty: 1 }] });
  const setIng = (id, i, p) => { const m = data.meals.find((x) => x.id === id); const items = m.items.map((it, j) => (j === i ? { ...it, ...p } : it)); setMeal(id, { items }); };
  const delIng = (id, i) => { const m = data.meals.find((x) => x.id === id); setMeal(id, { items: m.items.filter((_, j) => j !== i) }); };
  const mealCost = (m) => m.items.reduce((s, it) => s + num(it.qty) * num(pbPrice(it.itemId)), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <SectionTitle>Meals</SectionTitle>
        <Btn tone="solid" onClick={addMeal}><Plus size={15} />New meal</Btn>
      </div>
      <p className="text-sm mb-3" style={{ color: C.sub }}>Define a meal and its ingredients once. Editing it here updates every day it appears on the plan.</p>
      <div className="flex flex-col gap-2">
        {data.meals.map((m) => (
          <div key={m.id} className="rounded-lg" style={{ border: `1px solid ${C.line}` }}>
            <div className="flex items-center gap-2 px-3 py-2">
              <button onClick={() => setOpen(open === m.id ? null : m.id)} style={{ color: C.sub }}>
                {open === m.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <input value={m.name} onChange={(e) => setMeal(m.id, { name: e.target.value })}
                className="font-semibold outline-none flex-1 min-w-0" style={{ color: C.ink }} />
              <select value={m.mealTime} onChange={(e) => setMeal(m.id, { mealTime: e.target.value })}
                className="text-xs rounded px-1.5 py-1 outline-none" style={{ border: `1px solid ${C.line}`, color: C.dark, background: C.light }}>
                {MEALTIMES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <span className="text-xs hidden sm:inline" style={{ color: C.sub }}>{m.items.length} items</span>
              <Money v={mealCost(m)} bold color={C.dark} />
              <button onClick={() => delMeal(m.id)} style={{ color: C.red }}><Trash2 size={15} /></button>
            </div>
            {open === m.id && (
              <div className="px-3 pb-3" style={{ borderTop: `1px solid ${C.line}` }}>
                <table className="w-full text-sm mt-2">
                  <thead><tr style={{ color: C.sub }} className="text-left text-xs">
                    <th className="py-1">Ingredient</th><th className="w-20 text-center">Qty</th><th className="w-24 text-right">Cost</th><th className="w-8"></th>
                  </tr></thead>
                  <tbody>
                    {m.items.map((it, i) => (
                      <tr key={i}>
                        <td className="py-1">
                          <select value={it.itemId} onChange={(e) => setIng(m.id, i, { itemId: e.target.value })}
                            className="w-full rounded px-1 py-1 outline-none" style={{ border: `1px solid ${C.line}` }}>
                            {foodItems.map((p) => <option key={p.id} value={p.id}>{p.item}</option>)}
                          </select>
                        </td>
                        <td className="text-center">
                          <input value={it.qty} onChange={(e) => setIng(m.id, i, { qty: e.target.value })} inputMode="decimal"
                            className="w-16 text-center rounded px-1 py-1 outline-none" style={{ border: `1px solid ${C.line}`, fontFamily: MONO }} />
                        </td>
                        <td className="text-right"><Money v={num(it.qty) * num(pbPrice(it.itemId))} /></td>
                        <td className="text-right"><button onClick={() => delIng(m.id, i)} style={{ color: C.red }}><X size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={() => addIng(m.id)} className="mt-2 text-sm inline-flex items-center gap-1" style={{ color: C.dark }}>
                  <Plus size={14} />Add ingredient
                </button>
                <div className="text-xs mt-1" style={{ color: C.sub }}>
                  Qty = how many shopping units to buy when this meal is on the plan once (e.g. 0.5 of a loaf, 1 kg of mince).
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================= GROCERY */
function Grocery({ data, derived, nonFoodRows, totals, aGet, aSet, gGet, gTog, setData, copyList, copied }) {
  const balColor = (v) => (v < 0 ? C.red : C.ok);
  const suppliers = data.suppliers || [];
  const pbById = Object.fromEntries(data.priceBook.map((p) => [p.id, p]));
  // Supplier on a grocery row lives on the underlying price-book item.
  const setPriceSupplier = (priceId, supplierId) =>
    setData({ ...data, priceBook: data.priceBook.map((p) => (p.id === priceId ? { ...p, supplierId } : p)) });

  const addNonFood = () => { const food = data.priceBook.find((p) => !p.isFood) || data.priceBook[0]; setData({ ...data, nonFood: [...data.nonFood, { id: uid(), itemId: food.id, qty: 1 }] }); };
  const setNonFood = (id, p) => setData({ ...data, nonFood: data.nonFood.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const delNonFood = (id) => setData({ ...data, nonFood: data.nonFood.filter((r) => r.id !== id) });
  const nonFoodOpts = data.priceBook.filter((p) => !p.isFood);

  const addExtra = () => setData({ ...data, extras: [...data.extras, { id: uid(), item: "", qty: 1, price: 0 }] });
  const setExtra = (id, p) => setData({ ...data, extras: data.extras.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const delExtra = (id) => setData({ ...data, extras: data.extras.filter((e) => e.id !== id) });

  /* ---- shop-by-supplier breakdown (what to buy where) ---- */
  const supName = (sid) => suppliers.find((s) => s.id === sid)?.name;
  const [copiedShop, setCopiedShop] = useState(null);
  const shops = useMemo(() => {
    const g = {};
    const addLine = (sid, label, cost, got) => {
      const k = sid || "__none";
      if (!g[k]) g[k] = { id: sid, name: sid ? (supName(sid) || "Supplier") : "Unassigned", lines: [], total: 0, remaining: 0 };
      g[k].lines.push({ label, cost, got });
      g[k].total += cost;
      if (!got) g[k].remaining += cost;
    };
    derived.list.forEach((r) => addLine(pbById[r.id]?.supplierId, `${r.item} ×${+r.qty.toFixed(2)}${r.unit ? " " + r.unit : ""}`, r.cost, gGet("f_" + r.id)));
    nonFoodRows.forEach((r) => addLine(pbById[r.itemId]?.supplierId, `${r.item} ×${+num(r.qty).toFixed(2)}${r.unit ? " " + r.unit : ""}`, r.cost, gGet("n_" + r.id)));
    data.extras.forEach((e) => { if (e.item || num(e.price)) addLine(e.supplierId, `${e.item || "(extra)"} ×${+num(e.qty).toFixed(2)}`, num(e.qty) * num(e.price), gGet("x_" + e.id)); });
    return Object.values(g).sort((a, b) => (a.name === "Unassigned") - (b.name === "Unassigned") || b.total - a.total);
  }, [data, derived, nonFoodRows]);

  const copyShop = (shop) => {
    const left = shop.lines.filter((l) => !l.got);
    const text = `${shop.name.toUpperCase()} — ${data.period}\n\n` + left.map((l) => `  [ ] ${l.label}`).join("\n");
    try { navigator.clipboard.writeText(text); setCopiedShop(shop.id || "__none"); setTimeout(() => setCopiedShop(null), 1500); } catch { /* */ }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* summary + meal-time split */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          <div style={{ background: C.dark }} className="px-3 py-2 text-white text-sm font-semibold">The numbers</div>
          <div className="divide-y" style={{ borderColor: C.line }}>
            <Row label="Food essentials — planned" v={totals.foodEst} />
            <Row label="Non-food essentials — planned" v={totals.nonFoodEst} />
            <Row label="Essentials total (food + non-food)" v={totals.essEst} bold fill={C.light} />
            <Row label="Left for extras after essentials" v={totals.leftForExtras} bold color={balColor(totals.leftForExtras)} fill={totals.leftForExtras < 0 ? C.redbg : C.light} />
            <Row label="Extras — planned" v={totals.extrasEst} />
            <Row label="Planned balance (budget − all planned)" v={totals.plannedBal} bold color={balColor(totals.plannedBal)} fill={totals.plannedBal < 0 ? C.redbg : C.light} />
            <Row label="Actually spent (entered at the till)" v={totals.actualSpent} />
            <Row label="Actual balance (budget − spent)" v={totals.actualBal} bold color={balColor(totals.actualBal)} fill={totals.actualBal < 0 ? C.redbg : C.light} />
          </div>
        </div>
        <div className="lg:col-span-2 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          <div style={{ background: C.mid }} className="px-3 py-2 text-white text-sm font-semibold">Food spend by meal time</div>
          <div className="divide-y" style={{ borderColor: C.line }}>
            {MEALTIMES.map((mt) => (
              <div key={mt} className="flex items-center justify-between px-3 py-2 text-sm">
                <span style={{ color: C.dark, fontWeight: 600 }}>{mt}</span>
                <Money v={derived.byMeal[mt] || 0} />
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2 text-sm" style={{ background: C.light }}>
              <span style={{ color: C.dark, fontWeight: 700 }}>All food</span>
              <Money v={totals.foodEst} bold color={C.dark} />
            </div>
          </div>
        </div>
      </div>

      {/* food essentials (auto) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionBar color={C.dark} title="Food essentials — built from your week plan" />
          <Btn tone="ghost" onClick={copyList}>{copied ? <CheckCircle2 size={15} color={C.ok} /> : <Copy size={15} />}{copied ? "Copied" : "Copy list"}</Btn>
        </div>
        <ListTable
          rows={derived.list.map((r) => ({
            key: "f_" + r.id, pid: r.id, item: r.item, sub: r.times.join(" · "), category: r.category,
            qty: +r.qty.toFixed(2), unit: r.unit, est: r.cost, supplierId: pbById[r.id]?.supplierId,
          }))}
          aGet={aGet} aSet={aSet} gGet={gGet} gTog={gTog}
          suppliers={suppliers} onSupplier={setPriceSupplier}
          empty="No food yet — add meals to your week plan and they'll appear here."
          totalEst={derived.total} accent={C.dark}
        />
      </div>

      {/* non-food essentials */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionBar color={C.amber} title="Non-food essentials — TP, nappies, household" />
          <Btn tone="ghost" onClick={addNonFood}><Plus size={15} />Add</Btn>
        </div>
        <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${C.line}` }}>
          <table className="w-full text-sm border-collapse" style={{ minWidth: 620 }}>
            <thead><tr>
              {["Item", "Category", "Qty", "Est. $", "Actual $", "Got", "Supplier", ""].map((h, i) => (
                <th key={i} style={th(C.amber)} className={i >= 2 && i <= 4 ? "text-center" : "text-left"}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {nonFoodRows.map((r, idx) => (
                <tr key={r.id} style={{ background: idx % 2 ? C.band : "#fff" }}>
                  <td style={td()}>
                    <select value={r.itemId} onChange={(e) => setNonFood(r.id, { itemId: e.target.value })}
                      className="w-full bg-transparent outline-none">
                      {nonFoodOpts.map((p) => <option key={p.id} value={p.id}>{p.item}</option>)}
                    </select>
                  </td>
                  <td style={td()} className="text-xs" >{r.category}</td>
                  <td style={td()} className="text-center">
                    <input value={r.qty} onChange={(e) => setNonFood(r.id, { qty: e.target.value })} inputMode="decimal"
                      className="w-14 text-center bg-transparent outline-none" style={{ fontFamily: MONO }} />
                    {r.unit ? <span className="text-xs" style={{ color: C.sub }}> {r.unit}</span> : null}
                  </td>
                  <td style={td()} className="text-right"><Money v={r.cost} /></td>
                  <td style={td()} className="text-center">
                    <input value={aGet("n_" + r.id)} onChange={(e) => aSet("n_" + r.id, e.target.value)} inputMode="decimal" placeholder="—"
                      className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
                  </td>
                  <td style={td()} className="text-center"><Tick on={gGet("n_" + r.id)} onClick={() => gTog("n_" + r.id)} /></td>
                  <td style={td()}><SupplierSelect suppliers={suppliers} value={pbById[r.itemId]?.supplierId} onChange={(v) => setPriceSupplier(r.itemId, v)} /></td>
                  <td style={td()} className="text-right"><button onClick={() => delNonFood(r.id)} style={{ color: C.red }}><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: C.amber, color: "#fff" }}>
              <td style={td()} className="font-bold" colSpan={3}>Non-food total</td>
              <td style={td()} className="text-right font-bold"><Money v={totals.nonFoodEst} color="#fff" bold /></td>
              <td style={td()} colSpan={4}></td>
            </tr></tfoot>
          </table>
        </div>
      </div>

      {/* extras */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <SectionBar color={C.blue} title="Extras — only if there's room" />
          <Btn tone="ghost" onClick={addExtra}><Plus size={15} />Add</Btn>
        </div>
        <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${C.line}` }}>
          <table className="w-full text-sm border-collapse" style={{ minWidth: 620 }}>
            <thead><tr>
              {["Item", "Qty", "Price", "Est. $", "Actual $", "Got", "Supplier", ""].map((h, i) => (
                <th key={i} style={th(C.blue)} className={i >= 1 && i <= 4 ? "text-center" : "text-left"}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.extras.map((e, idx) => (
                <tr key={e.id} style={{ background: idx % 2 ? C.band : "#fff" }}>
                  <td style={td()}>
                    <input value={e.item} onChange={(ev) => setExtra(e.id, { item: ev.target.value })} placeholder="Item…"
                      className="w-full bg-transparent outline-none" />
                  </td>
                  <td style={td()} className="text-center">
                    <input value={e.qty} onChange={(ev) => setExtra(e.id, { qty: ev.target.value })} inputMode="decimal"
                      className="w-14 text-center bg-transparent outline-none" style={{ fontFamily: MONO }} />
                  </td>
                  <td style={td()} className="text-center">
                    <PriceInput value={e.price} onCommit={(v) => setExtra(e.id, { price: v })}
                      className="w-16 text-center bg-transparent outline-none" style={{ fontFamily: MONO }} />
                  </td>
                  <td style={td()} className="text-right"><Money v={num(e.qty) * num(e.price)} /></td>
                  <td style={td()} className="text-center">
                    <input value={aGet("x_" + e.id)} onChange={(ev) => aSet("x_" + e.id, ev.target.value)} inputMode="decimal" placeholder="—"
                      className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
                  </td>
                  <td style={td()} className="text-center"><Tick on={gGet("x_" + e.id)} onClick={() => gTog("x_" + e.id)} /></td>
                  <td style={td()}><SupplierSelect suppliers={suppliers} value={e.supplierId} onChange={(v) => setExtra(e.id, { supplierId: v })} /></td>
                  <td style={td()} className="text-right"><button onClick={() => delExtra(e.id)} style={{ color: C.red }}><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: C.blue, color: "#fff" }}>
              <td style={td()} className="font-bold" colSpan={3}>Extras total</td>
              <td style={td()} className="text-right font-bold"><Money v={totals.extrasEst} color="#fff" bold /></td>
              <td style={td()} colSpan={4}></td>
            </tr></tfoot>
          </table>
        </div>
        {totals.plannedBal < 0 && (
          <div className="mt-2 text-sm px-3 py-2 rounded-md" style={{ background: C.redbg, color: C.red }}>
            You're {money(Math.abs(totals.plannedBal))} over budget. Trim an extra, or adjust the meal plan.
          </div>
        )}
      </div>

      {/* shop by supplier — what to buy where */}
      <div>
        <SectionBar color={C.mid} title="Shop by supplier — what to buy where" />
        <div className="grid gap-3 mt-2 sm:grid-cols-2 lg:grid-cols-3">
          {shops.map((shop) => (
            <div key={shop.id || "none"} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
              <div className="flex items-center justify-between px-3 py-2" style={{ background: shop.name === "Unassigned" ? C.band : C.light }}>
                <div className="inline-flex items-center gap-1.5 font-semibold" style={{ color: shop.name === "Unassigned" ? C.sub : C.dark }}>
                  <Store size={14} />{shop.name}
                </div>
                <Btn tone="ghost" onClick={() => copyShop(shop)} style={{ padding: "2px 6px" }}>
                  {copiedShop === (shop.id || "__none") ? <CheckCircle2 size={13} color={C.ok} /> : <Copy size={13} />}
                </Btn>
              </div>
              <div className="px-3 py-2 text-sm" style={{ maxHeight: 180, overflowY: "auto" }}>
                {shop.lines.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-2" style={{ opacity: l.got ? 0.5 : 1 }}>
                    <span style={{ textDecoration: l.got ? "line-through" : "none" }}>{l.label}</span>
                    <span style={{ fontFamily: MONO, color: C.sub }}>{money(l.cost)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-3 py-2 text-sm" style={{ borderTop: `1px solid ${C.line}` }}>
                <span style={{ color: C.sub }}>{shop.lines.filter((l) => !l.got).length} to buy</span>
                <span><span style={{ color: C.sub, fontSize: 12 }}>left </span><Money v={shop.remaining} bold color={C.dark} /></span>
              </div>
            </div>
          ))}
          {!shops.length && <div className="text-sm" style={{ color: C.sub }}>Plan some meals and the per-shop breakdown appears here.</div>}
        </div>
      </div>
    </div>
  );
}

/* ============================================================= PRICES */
function Prices({ data, setData, reload }) {
  const [importing, setImporting] = useState(false);
  const [look, setLook] = useState({}); // priceId -> { state: load|ok|err, msg }
  const [sort, setSort] = useState({ key: "item", dir: 1 });
  const [filter, setFilter] = useState({ q: "", category: "", food: "", supplier: "" });
  const suppliers = data.suppliers || [];
  const supName = (sid) => suppliers.find((s) => s.id === sid)?.name;
  const supNameOf = (p) => supName(p.supplierId) || "";
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const filterActive = filter.q || filter.category || filter.food || filter.supplier;
  const upd = (priceBook) => setData({ ...data, priceBook });
  const setP = (id, p) => upd(data.priceBook.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const supIdByName = (name) => suppliers.find((s) => s.name === name)?.id || null;
  const applyVendor = (p, vendor, price) => setP(p.id, { price: num(price), supplierId: supIdByName(vendor) });
  const refresh = async (p) => {
    setLook((s) => ({ ...s, [p.id]: { state: "load" } }));
    try {
      const r = await lookupPrice(p.item);
      const results = r.results || {};
      setLook((s) => ({ ...s, [p.id]: { state: "ok", results } }));
      // auto-apply the current supplier's price if we got one
      const cur = supName(p.supplierId);
      if (cur && results[cur] && results[cur].price) setP(p.id, { price: num(results[cur].price) });
    } catch {
      setLook((s) => ({ ...s, [p.id]: { state: "err", msg: "lookup failed" } }));
    }
  };
  const [dedupeMsg, setDedupeMsg] = useState(null);
  const runDedupe = async () => {
    if (!window.confirm("Merge price-book items that have identical names? References are kept.")) return;
    setDedupeMsg("Working…");
    try {
      const r = await dedupePrices();
      await reload();
      setDedupeMsg(r.removed ? `Removed ${r.removed} duplicate${r.removed === 1 ? "" : "s"}` : "No duplicates found");
      setTimeout(() => setDedupeMsg(null), 3000);
    } catch { setDedupeMsg("Dedupe failed"); }
  };
  const add = () => upd([...data.priceBook, { id: uid(), item: "New item", price: 0, unit: "ea", category: "Pantry & Dry", isFood: true, supplierId: null }]);
  const del = (id) => upd(data.priceBook.filter((x) => x.id !== id));
  const matches = (p) => {
    if (filter.q && !p.item.toLowerCase().includes(filter.q.toLowerCase())) return false;
    if (filter.category && p.category !== filter.category) return false;
    if (filter.food === "food" && !p.isFood) return false;
    if (filter.food === "non" && p.isFood) return false;
    if (filter.supplier === "__none" && p.supplierId) return false;
    if (filter.supplier && filter.supplier !== "__none" && p.supplierId !== filter.supplier) return false;
    return true;
  };
  const cmp = (a, b) => {
    const k = sort.key; let r = 0;
    if (k === "price") r = num(a.price) - num(b.price);
    else if (k === "isFood") r = a.isFood === b.isFood ? 0 : a.isFood ? -1 : 1;
    else if (k === "supplier") r = supNameOf(a).localeCompare(supNameOf(b));
    else r = String(a[k] || "").localeCompare(String(b[k] || ""));
    if (r === 0) r = a.item.localeCompare(b.item);
    return r * sort.dir;
  };
  const sorted = data.priceBook.filter(matches).sort(cmp);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <SectionTitle>Price Book</SectionTitle>
        <div className="flex items-center gap-2">
          {dedupeMsg && <span className="text-xs" style={{ color: C.sub }}>{dedupeMsg}</span>}
          <Btn tone="ghost" onClick={runDedupe}><Layers size={15} />Dedupe</Btn>
          <Btn tone="ghost" onClick={() => setImporting((v) => !v)}><Upload size={15} />Import receipt</Btn>
          <Btn tone="solid" onClick={add}><Plus size={15} />Add item</Btn>
        </div>
      </div>
      <p className="text-sm mb-3" style={{ color: C.sub }}>
        Your master list of items and prices. Meals and the grocery plan all pull from here — update a price once and everything recalculates.
        Import a Coles or Woolworths order PDF to add items automatically.
      </p>
      {importing && <ImportReceipts suppliers={suppliers} reload={reload} onClose={() => setImporting(false)} />}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} placeholder="Search items…"
          className="text-sm rounded px-2 py-1 outline-none" style={{ border: `1px solid ${C.line}`, minWidth: 180 }} />
        <select value={filter.category} onChange={(e) => setFilter((f) => ({ ...f, category: e.target.value }))}
          className="text-sm rounded px-2 py-1 outline-none bg-white" style={{ border: `1px solid ${C.line}` }}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter.food} onChange={(e) => setFilter((f) => ({ ...f, food: e.target.value }))}
          className="text-sm rounded px-2 py-1 outline-none bg-white" style={{ border: `1px solid ${C.line}` }}>
          <option value="">Food &amp; non-food</option>
          <option value="food">Food only</option>
          <option value="non">Non-food only</option>
        </select>
        <select value={filter.supplier} onChange={(e) => setFilter((f) => ({ ...f, supplier: e.target.value }))}
          className="text-sm rounded px-2 py-1 outline-none bg-white" style={{ border: `1px solid ${C.line}` }}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="__none">Unassigned</option>
        </select>
        <span className="text-xs" style={{ color: C.sub }}>{sorted.length} of {data.priceBook.length}</span>
        {filterActive && <button onClick={() => setFilter({ q: "", category: "", food: "", supplier: "" })} className="text-xs font-medium" style={{ color: C.dark }}>Clear</button>}
      </div>
      <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${C.line}` }}>
        <table className="w-full text-sm border-collapse" style={{ minWidth: 760 }}>
          <thead><tr>
            {[{ l: "Item", k: "item" }, { l: "Price", k: "price" }, { l: "Unit", k: "unit" }, { l: "Category", k: "category" }, { l: "Food?", k: "isFood" }, { l: "Supplier", k: "supplier" }, { l: "", k: null }].map((h, i) => (
              <th key={i} style={{ ...th(C.mid), cursor: h.k ? "pointer" : "default", userSelect: "none" }}
                className={i === 1 ? "text-center" : "text-left"}
                onClick={h.k ? () => toggleSort(h.k) : undefined}>
                {h.l}{sort.key === h.k && h.k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {sorted.map((p, idx) => (
              <tr key={p.id} style={{ background: idx % 2 ? C.band : "#fff" }}>
                <td style={td()}><input value={p.item} onChange={(e) => setP(p.id, { item: e.target.value })} className="w-full bg-transparent outline-none" /></td>
                <td style={td()} className="text-center">
                  <div className="inline-flex items-center gap-1">
                    <span style={{ color: C.sub }}>$</span>
                    <PriceInput value={p.price} onCommit={(v) => setP(p.id, { price: v })}
                      className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
                    <button onClick={() => refresh(p)} title="Look up current price at Coles & Woolworths" style={{ color: C.sub }}>
                      <RefreshCw size={12} className={look[p.id]?.state === "load" ? "animate-spin" : ""} />
                    </button>
                  </div>
                  {look[p.id]?.state === "err" && <div className="text-xs" style={{ color: C.amber }}>{look[p.id].msg}</div>}
                  {look[p.id]?.results && (
                    <div className="flex items-center justify-center gap-2 mt-0.5">
                      {["Woolworths", "Coles"].map((v) => {
                        const r = look[p.id].results[v];
                        const isCur = supName(p.supplierId) === v;
                        return r ? (
                          <button key={v} onClick={() => applyVendor(p, v, r.price)} title={`Use ${v} price and set supplier`}
                            className="text-xs rounded px-1" style={{ color: isCur ? C.dark : C.blue, fontWeight: isCur ? 700 : 500 }}>
                            {v[0]} {money(r.price)}
                          </button>
                        ) : (
                          <span key={v} className="text-xs" style={{ color: C.sub }}>{v[0]} —</span>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td style={td()}><input value={p.unit} onChange={(e) => setP(p.id, { unit: e.target.value })} className="w-16 bg-transparent outline-none" /></td>
                <td style={td()}>
                  <select value={p.category} onChange={(e) => setP(p.id, { category: e.target.value })} className="bg-transparent outline-none">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </td>
                <td style={td()}>
                  <button onClick={() => setP(p.id, { isFood: !p.isFood })}
                    className="px-2 py-0.5 rounded text-xs font-semibold"
                    style={{ background: p.isFood ? C.light : "#F0E6DA", color: p.isFood ? C.dark : C.amber }}>
                    {p.isFood ? "Food" : "Non-food"}
                  </button>
                </td>
                <td style={td()}><SupplierSelect suppliers={suppliers} value={p.supplierId} onChange={(v) => setP(p.id, { supplierId: v })} /></td>
                <td style={td()} className="text-right"><button onClick={() => del(p.id)} style={{ color: C.red }}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- receipt import panel ---------- */
function ImportReceipts({ suppliers, reload, onClose }) {
  const [items, setItems] = useState(null);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const onFiles = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    setBusy(true); setError(null);
    try {
      const res = await parseReceipts(files);
      setItems(res.items.map((it) => ({ ...it, include: true })));
      setSummary(res.summary);
    } catch (err) { setError(String(err.message || err)); }
    setBusy(false);
  };
  const setItem = (i, p) => setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const chosen = items ? items.filter((it) => it.include) : [];

  const doImport = async () => {
    if (!chosen.length) return;
    setBusy(true); setError(null);
    try {
      await commitImport(chosen);
      await reload();
      onClose();
    } catch (err) { setError(String(err.message || err)); setBusy(false); }
  };

  return (
    <div className="mb-3 rounded-lg p-3" style={{ border: `1px solid ${C.line}`, background: C.band }}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold" style={{ color: C.dark }}>Import from a Coles / Woolworths order PDF</div>
        <button onClick={onClose} style={{ color: C.sub }}><X size={16} /></button>
      </div>
      {!items && (
        <div>
          <input type="file" accept="application/pdf,.pdf" multiple onChange={onFiles} className="text-sm" />
          <p className="text-xs mt-1" style={{ color: C.sub }}>
            Pick one or more order PDFs. They're parsed and shown for review — nothing is added until you hit Import.
          </p>
        </div>
      )}
      {busy && <div className="text-sm mt-1" style={{ color: C.sub }}>Working…</div>}
      {error && <div className="text-sm mt-1" style={{ color: C.red }}>{error}</div>}
      {items && (
        <div>
          <div className="text-xs mb-2" style={{ color: C.sub }}>
            {summary.items} items from {summary.files} file(s) · {summary.vendors.join(", ") || "—"} · {summary.new} new, {summary.update} update
          </div>
          <div className="overflow-auto rounded" style={{ border: `1px solid ${C.line}`, maxHeight: 380 }}>
            <table className="w-full text-sm border-collapse" style={{ minWidth: 740 }}>
              <thead><tr>
                {["", "Item", "Price", "Unit", "Category", "Food?", "Supplier", ""].map((h, i) => (
                  <th key={i} style={th(C.dark)}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ background: it.include ? "#fff" : "#F1F3F2", opacity: it.include ? 1 : 0.5 }}>
                    <td style={td()}><input type="checkbox" checked={it.include} onChange={(e) => setItem(i, { include: e.target.checked })} /></td>
                    <td style={td()}><input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} className="w-full bg-transparent outline-none" style={{ minWidth: 220 }} /></td>
                    <td style={td()} className="text-center">
                      <PriceInput value={it.price} onCommit={(v) => setItem(i, { price: v })}
                        className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
                      {it.action === "update" && it.currentPrice != null && <div className="text-xs" style={{ color: C.sub }}>was {money(it.currentPrice)}</div>}
                    </td>
                    <td style={td()}><input value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} className="w-14 bg-transparent outline-none" /></td>
                    <td style={td()}>
                      <select value={it.category} onChange={(e) => setItem(i, { category: e.target.value })} className="bg-transparent outline-none text-xs">
                        {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </td>
                    <td style={td()} className="text-center">
                      <button onClick={() => setItem(i, { isFood: !it.isFood })} className="px-2 py-0.5 rounded text-xs font-semibold"
                        style={{ background: it.isFood ? C.light : "#F0E6DA", color: it.isFood ? C.dark : C.amber }}>
                        {it.isFood ? "Food" : "Non-food"}
                      </button>
                    </td>
                    <td style={td()}><SupplierSelect suppliers={suppliers} value={it.supplierId} onChange={(v) => setItem(i, { supplierId: v })} /></td>
                    <td style={{ ...td(), color: C.sub }} className="text-xs">{it.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Btn tone="solid" onClick={doImport}>Import {chosen.length} item{chosen.length === 1 ? "" : "s"}</Btn>
            <Btn tone="ghost" onClick={() => { setItems(null); setSummary(null); }}>Choose different files</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- shared bits ---------- */
const th = (bg) => ({ background: bg, color: "#fff", fontWeight: 600, fontSize: 12.5, padding: "8px 10px", textAlign: "left", border: `1px solid ${bg}` });
const td = () => ({ padding: "7px 10px", border: `1px solid ${C.line}`, verticalAlign: "middle" });
const SectionTitle = ({ children }) => <h2 className="font-bold text-lg" style={{ color: C.dark }}>{children}</h2>;
const SectionBar = ({ color, title }) => (
  <div className="px-3 py-1.5 rounded-md text-white text-sm font-semibold" style={{ background: color }}>{title}</div>
);
const Row = ({ label, v, bold, color, fill }) => (
  <div className="flex items-center justify-between px-3 py-2 text-sm" style={{ background: fill || "transparent" }}>
    <span style={{ color: bold ? C.dark : C.ink, fontWeight: bold ? 700 : 400 }}>{label}</span>
    <Money v={v} bold={bold} color={color || (bold ? C.dark : C.ink)} />
  </div>
);
const Tick = ({ on, onClick }) => (
  <button onClick={onClick} className="inline-flex items-center justify-center rounded"
    style={{ width: 22, height: 22, border: `1.5px solid ${on ? C.ok : C.line}`, background: on ? C.ok : "#fff" }}>
    {on && <Check size={14} color="#fff" />}
  </button>
);
function ListTable({ rows, aGet, aSet, gGet, gTog, empty, totalEst, accent, suppliers, onSupplier }) {
  if (!rows.length) return <div className="text-sm px-3 py-4 rounded-lg" style={{ border: `1px solid ${C.line}`, color: C.sub }}>{empty}</div>;
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${C.line}` }}>
      <table className="w-full text-sm border-collapse" style={{ minWidth: 720 }}>
        <thead><tr>
          {["Item", "Category", "Qty", "Est. $", "Actual $", "Got", "Supplier"].map((h, i) => (
            <th key={i} style={th(accent)} className={i >= 2 && i <= 4 ? "text-center" : "text-left"}>{h}</th>
          ))}
        </tr></thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.key} style={{ background: idx % 2 ? C.band : "#fff", opacity: gGet(r.key) ? 0.55 : 1 }}>
              <td style={td()}>
                <div style={{ fontWeight: 500, textDecoration: gGet(r.key) ? "line-through" : "none" }}>{r.item}</div>
                {r.sub && <div className="text-xs" style={{ color: C.sub }}>{r.sub}</div>}
              </td>
              <td style={td()} className="text-xs">{r.category}</td>
              <td style={td()} className="text-center"><span style={{ fontFamily: MONO }}>{r.qty}</span>{r.unit ? <span className="text-xs" style={{ color: C.sub }}> {r.unit}</span> : null}</td>
              <td style={td()} className="text-right"><Money v={r.est} /></td>
              <td style={td()} className="text-center">
                <input value={aGet(r.key)} onChange={(e) => aSet(r.key, e.target.value)} inputMode="decimal" placeholder="—"
                  className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
              </td>
              <td style={td()} className="text-center"><Tick on={gGet(r.key)} onClick={() => gTog(r.key)} /></td>
              <td style={td()}><SupplierSelect suppliers={suppliers} value={r.supplierId} onChange={(v) => onSupplier(r.pid, v)} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr style={{ background: accent, color: "#fff" }}>
          <td style={td()} className="font-bold" colSpan={3}>Food total</td>
          <td style={td()} className="text-right font-bold"><Money v={totalEst} color="#fff" bold /></td>
          <td style={td()} colSpan={3}></td>
        </tr></tfoot>
      </table>
    </div>
  );
}
