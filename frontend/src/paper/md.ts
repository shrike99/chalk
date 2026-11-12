/** Markdown with KaTeX maths, for documents. Raw HTML from Claude is never rendered. */
import { marked } from "marked";
import katex from "katex";

marked.use({ renderer: { html: ({ text }: { text: string }) => escHtml(text) } });

export function escHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Pull maths out before Markdown sees it (so _ and * inside it survive), then put it back rendered. */
function withMath(src: string, render: (s: string) => string): string {
  const parts: string[] = [];
  const keep = (tex: string, display: boolean) => {
    if (!display) tex = tex.replace(/\\frac(?=\s*\{)/g, "\\dfrac");  // exam papers print inline fractions full size
    parts.push(katex.renderToString(tex, { throwOnError: false, displayMode: display, output: "html", errorColor: "#8a3b2e" }));
    return `\u0000${parts.length - 1}\u0000`;
  };
  let s = src.replace(/\\\$/g, "\u0001");                                   // \$ is a literal dollar
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true));
  s = s.replace(/\\\((.+?)\\\)/g, (_, t) => keep(t, false));
  s = s.replace(/\$(?=\S)((?:\\.|[^$\n])+?)(?<=\S)\$(?!\d)/g, (_, t) => keep(t, false));
  let html = render(s);
  html = html.replace(/\u0000(\d+)\u0000/g, (_, i) => parts[+i]).replace(/\u0001/g, "$");
  return html;
}

export const md = (src: string) => withMath(src || "", (s) => marked.parse(s, { async: false }) as string);
export const mdInline = (src: string) => withMath(src || "", (s) => marked.parseInline(s, { async: false }) as string);

/** Claude's SVG figures, minus anything that could run or reach out. */
export function cleanSvg(src: string): string {
  const doc = new DOMParser().parseFromString(src, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return "";
  svg.querySelectorAll("script, foreignObject, iframe, image, use[href^='http'], a").forEach((n) => n.remove());
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    for (const a of Array.from(el.attributes)) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith("on") || ((a.name === "href" || a.name === "xlink:href") && !v.startsWith("#")) || v.startsWith("javascript:")) el.removeAttribute(a.name);
    }
  }
  svg.removeAttribute("width"); svg.removeAttribute("height");
  svg.setAttribute("class", "fig-svg");
  return new XMLSerializer().serializeToString(svg);
}
