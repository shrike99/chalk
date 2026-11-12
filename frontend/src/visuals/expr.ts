/**
 * A tiny, safe maths expression parser for plots: x, numbers, + - * / ^, parentheses,
 * implicit multiplication (2x, 3(x+1)), constants pi and e, and common functions.
 * Returns a function of x (NaN where undefined).
 */
const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log,
  log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

type Tok = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string };

function tokenize(src: string): Tok[] {
  const s = src.replace(/\*\*/g, "^").replace(/π/g, "pi").replace(/·|×/g, "*").replace(/−/g, "-").toLowerCase();
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/)!;
      out.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue;
    }
    if (/[a-z]/.test(ch)) {
      const m = s.slice(i).match(/^[a-z][a-z0-9]*/)!;
      let word = m[0];
      // split things like "xsin" or "pix" into known pieces
      if (!(word in FUNCS) && !(word in CONSTS) && word !== "x") {
        const known = [...Object.keys(FUNCS), ...Object.keys(CONSTS), "x"].sort((a, b) => b.length - a.length).find((k) => word.startsWith(k));
        if (!known) throw new Error(`Unknown name "${word}"`);
        word = known;
      }
      out.push({ t: "id", v: word }); i += word.length; continue;
    }
    if ("+-*/^(),".includes(ch)) { out.push({ t: "op", v: ch }); i++; continue; }
    throw new Error(`Unexpected "${ch}"`);
  }
  // implicit multiplication: 2x, 2(x), x(x), )(, )x, x pi …
  const res: Tok[] = [];
  out.forEach((tok, k) => {
    const prev = res[res.length - 1];
    const prevEnds = prev && (prev.t === "num" || (prev.t === "id" && !(prev.v in FUNCS)) || (prev.t === "op" && prev.v === ")"));
    const curStarts = tok.t === "num" || tok.t === "id" || (tok.t === "op" && tok.v === "(");
    if (k > 0 && prevEnds && curStarts) res.push({ t: "op", v: "*" });
    res.push(tok);
  });
  return res;
}

type Node = (x: number) => number;

export function compile(src: string): Node {
  // allow "y = ..." or "f(x) = ..."
  const rhs = src.includes("=") ? src.slice(src.lastIndexOf("=") + 1) : src;
  const toks = tokenize(rhs);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v && !(t.t === "op" && t.v === v))) throw new Error(`Expected ${v ?? "more input"}`);
    p++; return t;
  };
  const expr = (): Node => {
    let left = term();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = eat().v; const l = left, r = term();
      left = op === "+" ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return left;
  };
  const term = (): Node => {
    let left = unary();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = eat().v; const l = left, r = unary();
      left = op === "*" ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
    }
    return left;
  };
  const unary = (): Node => {
    if (peek()?.t === "op" && peek()!.v === "-") { eat(); const u = unary(); return (x) => -u(x); }
    if (peek()?.t === "op" && peek()!.v === "+") { eat(); return unary(); }
    return power();
  };
  const power = (): Node => {
    const base = atom();
    if (peek()?.t === "op" && peek()!.v === "^") { eat(); const ex = unary(); return (x) => Math.pow(base(x), ex(x)); }
    return base;
  };
  const atom = (): Node => {
    const t = eat();
    if (t.t === "num") { const v = t.v; return () => v; }
    if (t.t === "id") {
      if (t.v === "x") return (x) => x;
      if (t.v in CONSTS) { const v = CONSTS[t.v]; return () => v; }
      const f = FUNCS[t.v];
      if (peek()?.t === "op" && peek()!.v === "(") { eat("("); const a = expr(); eat(")"); return (x) => f(a(x)); }
      const a = power(); return (x) => f(a(x)); // sin x
    }
    if (t.v === "(") { const e = expr(); eat(")"); return e; }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const fn = expr();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return (x) => { const y = fn(x); return Number.isFinite(y) ? y : NaN; };
}
