/**
 * JavaScript exercises run here, in a throwaway worker (a separate thread with no access to the page).
 * Each case has a time limit; a case that runs over (an infinite loop, or far too slow) is stopped by
 * killing the worker, and the cases after it are marked as not run. Results have the same shape as
 * the Python runner's, so the backend shapes and saves them the same way.
 */
export interface RunSpec {
  kind: "function" | "class" | "program";
  function?: string; class?: string; compare?: string; time_limit_ms?: number;
  cases: { args?: unknown[]; expected?: unknown; calls?: [string, unknown[]][]; compare?: string; time_limit_ms?: number }[];
}
export interface RunResult { i: number; status: string; got?: string; error?: string; line?: number | null; stdout?: string; ms?: number; bad_call?: number | null }
export interface RunOut { results: RunResult[]; stdout: string; ms: number; compile_error?: string; line?: number | null }

// The worker: compiles the student's code once, then runs one case per message.
const WORKER = String.raw`
let target = null, spec = null, loadOut = "";
const short = (v) => { let s; try { s = JSON.stringify(v); } catch { s = String(v); } if (s === undefined) s = String(v); return s.length > 600 ? s.slice(0, 600) + "…" : s; };
const plain = (v) => {
  if (v instanceof Set) v = [...v].sort();
  if (v instanceof Map) v = Object.fromEntries(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = plain(v[k]); return o; }
  return v === undefined ? null : v;
};
const key = (x) => JSON.stringify(x);
const eq = (a, b) => key(a) === key(b);
function same(got, want, how) {
  got = plain(got); want = plain(want);
  if (how === "approx") {
    if (typeof got === "number" && typeof want === "number") return Math.abs(got - want) <= Math.max(1e-9, 1e-6 * Math.abs(want));
    if (Array.isArray(got) && Array.isArray(want) && got.length === want.length) return got.every((g, k) => same(g, want[k], "approx"));
    return eq(got, want);
  }
  if (how === "unordered" && Array.isArray(got) && Array.isArray(want)) return eq([...got].map(key).sort(), [...want].map(key).sort());
  if (how === "unordered_nested" && Array.isArray(got) && Array.isArray(want)) {
    const norm = (l) => l.map((x) => Array.isArray(x) ? key([...x].map(key).sort()) : key(x)).sort();
    return eq(norm(got), norm(want));
  }
  return eq(got, want);
}
function lineOf(e) {
  const m = String(e && e.stack || "").match(/<anonymous>:(\d+):\d+/);
  return m ? Math.max(1, Number(m[1]) - 2) : null;
}
let out = [];
const fmt = (a) => a.map((x) => typeof x === "string" ? x : short(x)).join(" ");
self.console = { log: (...a) => out.push(fmt(a)), info: (...a) => out.push(fmt(a)), warn: (...a) => out.push(fmt(a)), error: (...a) => out.push(fmt(a)) };
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === "load") {
    spec = m.spec;
    const name = spec.kind === "class" ? spec.class : spec.function;
    out = [];
    try {
      const fn = new Function(m.code + "\n;return (typeof " + name + " !== 'undefined') ? " + name + " : undefined;");
      target = fn();
    } catch (e) {
      postMessage({ type: "loaded", compile_error: (e && e.name ? e.name + ": " : "") + (e && e.message || e), line: lineOf(e), stdout: out.join("\n") });
      return;
    }
    loadOut = out.join("\n");
    if (typeof target !== "function") {
      postMessage({ type: "loaded", compile_error: "Couldn't find " + (spec.kind === "class" ? "a class" : "a function") + " called " + name + " in your code.", stdout: loadOut });
      return;
    }
    postMessage({ type: "loaded", stdout: loadOut ? loadOut + "\n" : "" });
    return;
  }
  if (m.type === "case") {
    const c = spec.cases[m.i];
    out = [];
    const t0 = performance.now();
    const box = { i: m.i };
    try {
      if (spec.kind === "function") {
        const got = target(...(c.args || []));
        box.status = same(got, c.expected, c.compare || spec.compare || "exact") ? "pass" : "fail";
        box.got = short(plain(got));
      } else {
        let obj = null; const results = [];
        (c.calls || []).forEach(([name, args], k) => {
          if (k === 0) { obj = new target(...(args || [])); results.push(null); }
          else results.push(plain(obj[name](...(args || []))));
        });
        const want = c.expected || [];
        let bad = results.findIndex((g, k) => !same(g, want[k], c.compare || "exact"));
        if (bad === -1 && results.length !== want.length) bad = Math.min(results.length, want.length);
        box.status = bad === -1 ? "pass" : "fail"; box.got = short(results); box.bad_call = bad === -1 ? null : bad;
      }
    } catch (e) {
      box.status = "error";
      box.error = e instanceof RangeError && /call stack/i.test(e.message) ? "RangeError: maximum call stack size exceeded (does your recursion stop?)" : (e && e.name ? e.name + ": " : "") + (e && e.message || e);
      box.line = lineOf(e);
    }
    box.ms = Math.round((performance.now() - t0) * 10) / 10;
    box.stdout = out.length ? out.join("\n") + "\n" : "";
    postMessage({ type: "case", box });
  }
};
`;

let workerUrl: string | null = null;
const newWorker = () => {
  workerUrl ??= URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
  return new Worker(workerUrl);
};

export async function runJs(code: string, spec: RunSpec): Promise<RunOut> {
  const t0 = performance.now();
  const results: RunResult[] = [];
  let w = newWorker();
  const next = <T>(ms: number) => new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => { w.onmessage = null; resolve(null); }, ms);
    w.onmessage = (e) => { clearTimeout(timer); resolve(e.data as T); };
  });
  try {
    w.postMessage({ type: "load", code, spec });
    const loaded = await next<{ compile_error?: string; line?: number; stdout: string }>(3000);
    if (!loaded) return { results: [], stdout: "", ms: 0, compile_error: "Your code took too long just to load: is there a loop outside a function?" };
    if (loaded.compile_error) return { results: [], stdout: loaded.stdout ?? "", ms: 0, compile_error: loaded.compile_error, line: loaded.line };
    const limit = spec.time_limit_ms ?? 2000;
    for (let i = 0; i < spec.cases.length; i++) {
      w.postMessage({ type: "case", i });
      const r = await next<{ box: RunResult }>(spec.cases[i].time_limit_ms ?? limit);
      if (!r) {
        results.push({ i, status: "timeout" });
        for (let j = i + 1; j < spec.cases.length; j++) results.push({ i: j, status: "skipped" });
        w.terminate();
        w = newWorker();  // (not used further; keeps the reference valid)
        break;
      }
      results.push(r.box);
    }
    return { results, stdout: loaded.stdout ?? "", ms: Math.round(performance.now() - t0) };
  } finally {
    w.terminate();
  }
}
