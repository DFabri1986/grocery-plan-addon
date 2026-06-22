import { describe, it, expect } from "vitest";
import { pushDiff, applyIdMap } from "./sync.js";

const EMPTY = {
  budget: 0, period: "Week", priceBook: [], meals: [], nonFood: [], extras: [],
  suppliers: [], people: [], weeks: [], plans: {}, shop: {},
};

function fakeApi(log, idByPath = {}) {
  return async (path, method = "GET", body) => {
    log.push([method, path, body]);
    if (method === "POST") {
      const id = idByPath[path] ?? Math.floor(Math.random() * 1e6);
      return { id };
    }
    return null;
  };
}

describe("pushDiff people/weeks/plans/shop", () => {
  it("creates a person then a week referencing the real person id", async () => {
    const log = [];
    const api = fakeApi(log, { "people/": 42, "weeks/": 7 });
    const prev = structuredClone(EMPTY);
    const next = structuredClone(EMPTY);
    next.people = [{ id: "tmp_p", name: "Sara", order: 0 }];
    next.weeks = [{ id: "tmp_w", personId: "tmp_p", weekStart: "2026-06-22" }];
    const idMap = await pushDiff(api, prev, next);
    expect(idMap.person["tmp_p"]).toBe("42");
    expect(idMap.week["tmp_w"]).toBe("7");
    const weekPost = log.find(([m, p]) => m === "POST" && p === "weeks/");
    expect(weekPost[2]).toEqual({ personId: "42", weekStart: "2026-06-22" });
  });

  it("PUTs a week's plan to weeks/<id>/plan/ with translated meal ids", async () => {
    const log = [];
    const api = fakeApi(log);
    const prev = structuredClone(EMPTY);
    prev.weeks = [{ id: "5", personId: "1", weekStart: "2026-06-22" }];
    prev.plans = { "5": {} };
    const next = structuredClone(prev);
    next.plans = { "5": { Mon: { Breakfast: ["9"] } } };
    await pushDiff(api, prev, next);
    const put = log.find(([m, p]) => m === "PUT" && p === "weeks/5/plan/");
    expect(put[2]).toEqual({ Mon: { Breakfast: ["9"] } });
  });

  it("PUTs shop per week with weekStart in the body", async () => {
    const log = [];
    const api = fakeApi(log);
    const prev = structuredClone(EMPTY);
    const next = structuredClone(EMPTY);
    next.shop = { "2026-06-22": { actuals: { "f_1": 3 }, got: { "f_1": true } } };
    await pushDiff(api, prev, next);
    const put = log.find(([m, p]) => m === "PUT" && p === "shop/");
    expect(put[2]).toEqual({ weekStart: "2026-06-22", actuals: { "f_1": 3 }, got: { "f_1": true } });
  });

  it("applyIdMap remaps person and week ids", () => {
    const d = structuredClone(EMPTY);
    d.people = [{ id: "tmp_p", name: "Sara", order: 0 }];
    d.weeks = [{ id: "tmp_w", personId: "tmp_p", weekStart: "2026-06-22" }];
    d.plans = { "tmp_w": { Mon: { Breakfast: ["tmp_m"] } } };
    const idMap = { price: {}, meal: { "tmp_m": "9" }, nonfood: {}, extra: {}, person: { "tmp_p": "42" }, week: { "tmp_w": "7" } };
    const out = applyIdMap(d, idMap);
    expect(out.people[0].id).toBe("42");
    expect(out.weeks[0].id).toBe("7");
    expect(out.weeks[0].personId).toBe("42");
    expect(out.plans["7"].Mon.Breakfast).toEqual(["9"]);
  });
});
