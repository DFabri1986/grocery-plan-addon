import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Trash2, Check, Copy, RotateCcw, ChevronDown, ChevronRight,
  CalendarDays, ShoppingCart, BookOpen, Tag, X, CheckCircle2,
} from "lucide-react";

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

const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const uid = () => Math.random().toString(36).slice(2, 9);

/* ---------- seed data ---------- */
function seed() {
  const pb = [
    ["Weet-Bix / cereal", 4.5, "box", "Pantry & Dry", true],
    ["Milk 2L", 3.3, "ea", "Dairy & Eggs", true],
    ["Eggs (dozen)", 5.5, "dozen", "Dairy & Eggs", true],
    ["Butter", 5.5, "250g", "Dairy & Eggs", true],
    ["Muesli bars", 4.0, "pack", "Snacks & Treats", true],
    ["Apples / bananas", 4.0, "kg", "Fresh Produce", true],
    ["Yoghurt pouches", 5.0, "pack", "Dairy & Eggs", true],
    ["Sandwich loaf", 2.8, "loaf", "Bakery", true],
    ["Ham / sandwich filling", 5.5, "pack", "Meat & Seafood", true],
    ["Block cheese", 7.0, "500g", "Dairy & Eggs", true],
    ["Wraps", 3.5, "pack", "Bakery", true],
    ["Chicken breast", 11.0, "kg", "Meat & Seafood", true],
    ["Beef mince", 13.0, "kg", "Meat & Seafood", true],
    ["Pasta 500g", 1.5, "ea", "Pantry & Dry", true],
    ["Tinned tomatoes", 1.1, "tin", "Pantry & Dry", true],
    ["Rice 1kg", 3.0, "ea", "Pantry & Dry", true],
    ["Brown onion", 0.5, "ea", "Fresh Produce", true],
    ["Mixed veg (frozen)", 4.5, "kg", "Frozen", true],
    ["Crackers", 3.0, "pack", "Snacks & Treats", true],
    ["Toilet paper", 8.0, "pack", "Household", false],
    ["Nappies", 18.0, "pack", "Baby & Kids", false],
    ["Baby wipes", 4.0, "pack", "Baby & Kids", false],
    ["Dishwashing liquid", 3.5, "bottle", "Household", false],
    ["Laundry liquid", 8.0, "bottle", "Household", false],
    ["Bin liners", 4.0, "pack", "Household", false],
    ["Toothpaste", 4.0, "tube", "Health & Personal", false],
    ["Dry pet food", 15.0, "bag", "Pet", false],
    ["Ice cream", 6.0, "tub", "Snacks & Treats", true],
  ].map(([item, price, unit, category, isFood]) => ({ id: uid(), item, price, unit, category, isFood }));

  const P = (name) => pb.find((p) => p.item === name).id;

  const meals = [
    { id: uid(), name: "Weet-Bix & milk", mealTime: "Breakfast",
      items: [{ itemId: P("Weet-Bix / cereal"), qty: 0.25 }, { itemId: P("Milk 2L"), qty: 0.3 }] },
    { id: uid(), name: "Eggs on toast", mealTime: "Breakfast",
      items: [{ itemId: P("Eggs (dozen)"), qty: 0.5 }, { itemId: P("Sandwich loaf"), qty: 0.4 }, { itemId: P("Butter"), qty: 0.2 }] },
    { id: uid(), name: "Muesli bar & fruit", mealTime: "Recess",
      items: [{ itemId: P("Muesli bars"), qty: 0.4 }, { itemId: P("Apples / bananas"), qty: 0.3 }, { itemId: P("Yoghurt pouches"), qty: 0.4 }] },
    { id: uid(), name: "Ham & cheese sandwich", mealTime: "Lunch",
      items: [{ itemId: P("Sandwich loaf"), qty: 0.5 }, { itemId: P("Ham / sandwich filling"), qty: 0.5 }, { itemId: P("Block cheese"), qty: 0.25 }] },
    { id: uid(), name: "Cheese wrap", mealTime: "Lunch",
      items: [{ itemId: P("Wraps"), qty: 0.5 }, { itemId: P("Block cheese"), qty: 0.25 }, { itemId: P("Apples / bananas"), qty: 0.2 }] },
    { id: uid(), name: "Spag bol", mealTime: "Dinner",
      items: [{ itemId: P("Beef mince"), qty: 1 }, { itemId: P("Pasta 500g"), qty: 1 }, { itemId: P("Tinned tomatoes"), qty: 2 }, { itemId: P("Brown onion"), qty: 1 }] },
    { id: uid(), name: "Chicken & veg", mealTime: "Dinner",
      items: [{ itemId: P("Chicken breast"), qty: 1 }, { itemId: P("Mixed veg (frozen)"), qty: 0.5 }, { itemId: P("Rice 1kg"), qty: 0.5 }] },
    { id: uid(), name: "Crackers & cheese", mealTime: "Snacks",
      items: [{ itemId: P("Crackers"), qty: 0.5 }, { itemId: P("Block cheese"), qty: 0.2 }] },
  ];
  const M = (name) => meals.find((m) => m.name === name).id;

  const week = {};
  DAYS.forEach((d, i) => {
    week[d] = {
      Breakfast: [i % 2 ? M("Eggs on toast") : M("Weet-Bix & milk")],
      Recess: SCHOOL.has(d) ? [M("Muesli bar & fruit")] : [],
      Lunch: SCHOOL.has(d) ? [i % 2 ? M("Cheese wrap") : M("Ham & cheese sandwich")] : [],
      Dinner: [i % 2 ? M("Chicken & veg") : M("Spag bol")],
      Snacks: i < 3 ? [M("Crackers & cheese")] : [],
    };
  });

  const nonFood = ["Toilet paper", "Nappies", "Baby wipes", "Dishwashing liquid", "Laundry liquid", "Bin liners"]
    .map((n) => ({ id: uid(), itemId: P(n), qty: 1 }));

  return {
    budget: 300, period: "Week", priceBook: pb, meals, week, nonFood,
    extras: [{ id: uid(), item: "Treat night ice cream", qty: 1, price: 6 }],
    actuals: {}, got: {},
  };
}

/* ---------- storage ---------- */
const KEY = "grocery-planner-v1";
const hasStore = typeof window !== "undefined" && window.storage && typeof window.storage.get === "function";
async function loadState() {
  if (!hasStore) return null;
  try { const r = await window.storage.get(KEY); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function saveState(s) {
  if (!hasStore) return;
  try { await window.storage.set(KEY, JSON.stringify(s)); } catch { /* keep working in-memory */ }
}

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

/* ============================================================= */
export default function GroceryPlanner() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("week");
  const [saved, setSaved] = useState(true);
  const loaded = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    (async () => {
      const s = await loadState();
      setData(s || seed());
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current || !data) return;
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => { await saveState(data); setSaved(true); }, 600);
  }, [data]);

  const patch = (p) => setData((d) => ({ ...d, ...p }));

  /* ---- derive grocery list from week plan ---- */
  const derived = useMemo(() => {
    if (!data) return { list: [], byMeal: {}, total: 0 };
    const map = {};
    const byMeal = { Breakfast: 0, Recess: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
    DAYS.forEach((day) => MEALTIMES.forEach((mt) => {
      (data.week[day]?.[mt] || []).forEach((mealId) => {
        const meal = data.meals.find((m) => m.id === mealId);
        if (!meal) return;
        meal.items.forEach((ing) => {
          const pb = data.priceBook.find((p) => p.id === ing.itemId);
          if (!pb || !pb.isFood) return;
          const cost = num(ing.qty) * num(pb.price);
          if (!map[pb.id]) map[pb.id] = { id: pb.id, item: pb.item, category: pb.category, unit: pb.unit, qty: 0, cost: 0, times: {} };
          map[pb.id].qty += num(ing.qty);
          map[pb.id].cost += cost;
          map[pb.id].times[mt] = true;
          byMeal[mt] += cost;
        });
      });
    }));
    const list = Object.values(map)
      .map((x) => ({ ...x, times: MEALTIMES.filter((t) => x.times[t]) }))
      .sort((a, b) => a.category.localeCompare(b.category) || a.item.localeCompare(b.item));
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
  const [copied, setCopied] = useState(false);
  const copyList = () => {
    const lines = [];
    const group = (title, rows) => {
      const left = rows.filter((r) => !r.got);
      if (!left.length) return;
      lines.push(title.toUpperCase());
      left.forEach((r) => lines.push(`  [ ] ${r.label}`));
      lines.push("");
    };
    group("Food essentials", derived.list.map((r) => ({ got: gGet("f_" + r.id), label: `${r.item}  ×${(+r.qty.toFixed(2))}` })));
    group("Non-food essentials", nonFoodRows.map((r) => ({ got: gGet("n_" + r.id), label: `${r.item}  ×${(+num(r.qty).toFixed(2))}` })));
    group("Extras", data.extras.map((e) => ({ got: gGet("x_" + e.id), label: `${e.item}  ×${(+num(e.qty).toFixed(2))}` })));
    const text = `GROCERY LIST (${data.period})\n\n` + lines.join("\n");
    try { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
  };

  const reset = () => { if (window.confirm("Reset everything back to the starting example?")) setData(seed()); };

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
              <input value={data.budget} onChange={(e) => patch({ budget: num(e.target.value) })}
                inputMode="decimal" className="w-20 bg-transparent outline-none text-right font-bold"
                style={{ fontFamily: MONO, color: "#0000CC" }} />
              <span className="text-xs" style={{ color: C.sub }}>/</span>
              <input value={data.period} onChange={(e) => patch({ period: e.target.value })}
                className="w-20 bg-transparent outline-none font-semibold text-sm" style={{ color: "#0000CC" }} />
            </div>
            <span className="text-xs px-2 py-1 rounded-md" style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}>
              {saved ? "Saved" : "Saving…"}
            </span>
            <Btn tone="ghost" onClick={reset} title="Reset to example"><RotateCcw size={15} /></Btn>
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
        {tab === "prices" && <Prices data={data} setData={setData} />}
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
  const pbName = (id) => data.priceBook.find((p) => p.id === id)?.item || "?";
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
  const t = totals;
  const balColor = (v) => (v < 0 ? C.red : C.ok);

  const addNonFood = () => { const food = data.priceBook.find((p) => !p.isFood) || data.priceBook[0]; setData({ ...data, nonFood: [...data.nonFood, { id: uid(), itemId: food.id, qty: 1 }] }); };
  const setNonFood = (id, p) => setData({ ...data, nonFood: data.nonFood.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const delNonFood = (id) => setData({ ...data, nonFood: data.nonFood.filter((r) => r.id !== id) });
  const nonFoodOpts = data.priceBook.filter((p) => !p.isFood);

  const addExtra = () => setData({ ...data, extras: [...data.extras, { id: uid(), item: "", qty: 1, price: 0 }] });
  const setExtra = (id, p) => setData({ ...data, extras: data.extras.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  const delExtra = (id) => setData({ ...data, extras: data.extras.filter((e) => e.id !== id) });

  return (
    <div className="flex flex-col gap-5">
      {/* summary + meal-time split */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-lg overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
          <div style={{ background: C.dark }} className="px-3 py-2 text-white text-sm font-semibold">The numbers</div>
          <div className="divide-y" style={{ borderColor: C.line }}>
            <Row label="Food essentials — planned" v={t.foodEst} />
            <Row label="Non-food essentials — planned" v={t.nonFoodEst} />
            <Row label="Essentials total (food + non-food)" v={t.essEst} bold fill={C.light} />
            <Row label="Left for extras after essentials" v={t.leftForExtras} bold color={balColor(t.leftForExtras)} fill={t.leftForExtras < 0 ? C.redbg : C.light} />
            <Row label="Extras — planned" v={t.extrasEst} />
            <Row label="Planned balance (budget − all planned)" v={t.plannedBal} bold color={balColor(t.plannedBal)} fill={t.plannedBal < 0 ? C.redbg : C.light} />
            <Row label="Actually spent (entered at the till)" v={t.actualSpent} />
            <Row label="Actual balance (budget − spent)" v={t.actualBal} bold color={balColor(t.actualBal)} fill={t.actualBal < 0 ? C.redbg : C.light} />
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
              <Money v={t.foodEst} bold color={C.dark} />
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
            key: "f_" + r.id, item: r.item, sub: r.times.join(" · "), category: r.category,
            qty: +r.qty.toFixed(2), est: r.cost,
          }))}
          aGet={aGet} aSet={aSet} gGet={gGet} gTog={gTog}
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
              {["Item", "Category", "Qty", "Est. $", "Actual $", "Got", ""].map((h, i) => (
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
                  </td>
                  <td style={td()} className="text-right"><Money v={r.cost} /></td>
                  <td style={td()} className="text-center">
                    <input value={aGet("n_" + r.id)} onChange={(e) => aSet("n_" + r.id, e.target.value)} inputMode="decimal" placeholder="—"
                      className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
                  </td>
                  <td style={td()} className="text-center"><Tick on={gGet("n_" + r.id)} onClick={() => gTog("n_" + r.id)} /></td>
                  <td style={td()} className="text-right"><button onClick={() => delNonFood(r.id)} style={{ color: C.red }}><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: C.amber, color: "#fff" }}>
              <td style={td()} className="font-bold" colSpan={3}>Non-food total</td>
              <td style={td()} className="text-right font-bold"><Money v={totals.nonFoodEst} color="#fff" bold /></td>
              <td style={td()} colSpan={3}></td>
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
              {["Item", "Qty", "Price", "Est. $", "Actual $", "Got", ""].map((h, i) => (
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
                    <input value={e.price} onChange={(ev) => setExtra(e.id, { price: ev.target.value })} inputMode="decimal"
                      className="w-16 text-center bg-transparent outline-none" style={{ fontFamily: MONO }} />
                  </td>
                  <td style={td()} className="text-right"><Money v={num(e.qty) * num(e.price)} /></td>
                  <td style={td()} className="text-center">
                    <input value={aGet("x_" + e.id)} onChange={(ev) => aSet("x_" + e.id, ev.target.value)} inputMode="decimal" placeholder="—"
                      className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
                  </td>
                  <td style={td()} className="text-center"><Tick on={gGet("x_" + e.id)} onClick={() => gTog("x_" + e.id)} /></td>
                  <td style={td()} className="text-right"><button onClick={() => delExtra(e.id)} style={{ color: C.red }}><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr style={{ background: C.blue, color: "#fff" }}>
              <td style={td()} className="font-bold" colSpan={3}>Extras total</td>
              <td style={td()} className="text-right font-bold"><Money v={totals.extrasEst} color="#fff" bold /></td>
              <td style={td()} colSpan={3}></td>
            </tr></tfoot>
          </table>
        </div>
        {totals.plannedBal < 0 && (
          <div className="mt-2 text-sm px-3 py-2 rounded-md" style={{ background: C.redbg, color: C.red }}>
            You're {money(Math.abs(totals.plannedBal))} over budget. Trim an extra, or adjust the meal plan.
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================= PRICES */
function Prices({ data, setData }) {
  const upd = (priceBook) => setData({ ...data, priceBook });
  const setP = (id, p) => upd(data.priceBook.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const add = () => upd([...data.priceBook, { id: uid(), item: "New item", price: 0, unit: "ea", category: "Pantry & Dry", isFood: true }]);
  const del = (id) => upd(data.priceBook.filter((x) => x.id !== id));
  const sorted = [...data.priceBook].sort((a, b) => (a.isFood === b.isFood ? 0 : a.isFood ? -1 : 1) || a.category.localeCompare(b.category) || a.item.localeCompare(b.item));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <SectionTitle>Price Book</SectionTitle>
        <Btn tone="solid" onClick={add}><Plus size={15} />Add item</Btn>
      </div>
      <p className="text-sm mb-3" style={{ color: C.sub }}>
        Your master list of items and prices. Meals and the grocery plan all pull from here — update a price once and everything recalculates.
        Rough mid-2026 ballparks to start; overwrite with your own receipt prices.
      </p>
      <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${C.line}` }}>
        <table className="w-full text-sm border-collapse" style={{ minWidth: 680 }}>
          <thead><tr>
            {["Item", "Price", "Unit", "Category", "Food?", ""].map((h, i) => (
              <th key={i} style={th(C.mid)} className={i === 1 ? "text-center" : "text-left"}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {sorted.map((p, idx) => (
              <tr key={p.id} style={{ background: idx % 2 ? C.band : "#fff" }}>
                <td style={td()}><input value={p.item} onChange={(e) => setP(p.id, { item: e.target.value })} className="w-full bg-transparent outline-none" /></td>
                <td style={td()} className="text-center">
                  <span style={{ color: C.sub }}>$</span>
                  <input value={p.price} onChange={(e) => setP(p.id, { price: num(e.target.value) })} inputMode="decimal"
                    className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
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
                <td style={td()} className="text-right"><button onClick={() => del(p.id)} style={{ color: C.red }}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
function ListTable({ rows, aGet, aSet, gGet, gTog, empty, totalEst, accent }) {
  if (!rows.length) return <div className="text-sm px-3 py-4 rounded-lg" style={{ border: `1px solid ${C.line}`, color: C.sub }}>{empty}</div>;
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${C.line}` }}>
      <table className="w-full text-sm border-collapse" style={{ minWidth: 640 }}>
        <thead><tr>
          {["Item", "Category", "Qty", "Est. $", "Actual $", "Got"].map((h, i) => (
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
              <td style={td()} className="text-center" ><span style={{ fontFamily: MONO }}>{r.qty}</span></td>
              <td style={td()} className="text-right"><Money v={r.est} /></td>
              <td style={td()} className="text-center">
                <input value={aGet(r.key)} onChange={(e) => aSet(r.key, e.target.value)} inputMode="decimal" placeholder="—"
                  className="w-16 text-right bg-transparent outline-none" style={{ fontFamily: MONO, color: "#0000CC" }} />
              </td>
              <td style={td()} className="text-center"><Tick on={gGet(r.key)} onClick={() => gTog(r.key)} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr style={{ background: accent, color: "#fff" }}>
          <td style={td()} className="font-bold" colSpan={3}>Food total</td>
          <td style={td()} className="text-right font-bold"><Money v={totalEst} color="#fff" bold /></td>
          <td style={td()} colSpan={2}></td>
        </tr></tfoot>
      </table>
    </div>
  );
}
