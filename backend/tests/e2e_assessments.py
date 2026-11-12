"""End-to-end assessment scenarios: upload files, ask for a paper, lay it out, print it, check it.

Runs the real backend (with Claude replaced by the replies in fixtures/make_replies.py), the real
upload pipeline and the real page renderer in Chrome. For each scenario it checks what would have
been sent to Claude, that the document came through, and that the PDF has no clipped pages, broken
maths or missing figures; then it saves side-by-side sheets (your file | Chalk's paper | mark scheme).

python backend/tests/e2e_assessments.py [out dir]     (needs: frontend built, playwright + Chrome, poppler)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import requests
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "fixtures"))
import make_inputs  # noqa: E402
import make_replies  # noqa: E402

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(tempfile.gettempdir()) / "chalk-e2e")
PORT = 8766
BASE = f"http://127.0.0.1:{PORT}"
ASK = {
    "gcse_follow": "Follow the format of this past paper and make me one on simultaneous equations and inequalities.",
    "uni_follow": "Make me a practice exam in exactly this format, different questions on the same topics.",
    "mcq_follow": "Same layout as this paper, but on electricity. Reuse the circuit diagram.",
    "interview_follow": "Give me two new problems in the same style as this interview sheet, with solutions.",
    "scanned_follow": "Make a worksheet like this one, on energy transfers.",
    "photo_questions": "Write me some exam questions about this graph.",
    "multi_paper_follow": "Follow the format of the following past papers.",
    "stress": "Stress test.",
    "latex_slips": "Trig warm-up please.",
    "truncated": "Follow this format.",
    "json_fence_script": "One fractions question.",
    "figure_gallery": "Show me every kind of figure.",
    "ipcv_follow": "Generate me a similar paper to these two past papers.",
    "reuse_refused": "Use the circuit from my paper.",
    "bad_figures": "Broken figures.",
}
EXPECT_FIGURE_ERRORS = {"bad_figures": 4}


def start_backend(data: Path, fx: Path) -> subprocess.Popen:
    env = os.environ | {"TUTOR_MOCK": "1", "CHALK_DATA": str(data), "CHALK_FIXTURES": str(fx), "CHALK_UI": str(ROOT / "frontend" / "dist")}
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "app:app", "--port", str(PORT)], cwd=ROOT / "backend", env=env,
                         stdout=open(OUT / "backend.log", "w"), stderr=subprocess.STDOUT)
    for _ in range(80):
        try:
            if requests.get(f"{BASE}/api/status", timeout=1).ok:
                return p
        except requests.RequestException:
            time.sleep(0.25)
    raise SystemExit("backend didn't start; see backend.log")


def turn(text: str, note_id: str, attachments: list[str]) -> dict:
    r = requests.post(f"{BASE}/api/turn", json={"text": text, "note_id": note_id, "attachments": attachments, "mode": "tutor"}, stream=True, timeout=60)
    r.raise_for_status()
    result = None
    for line in r.iter_lines():
        if line:
            ev = json.loads(line)
            if ev.get("type") == "result":
                result = ev
            if ev.get("type") == "error":
                raise RuntimeError(ev)
    return result or {}


def render(page, did: str, part: str, pdf_path: Path) -> dict:
    page.goto(f"{BASE}/paper.html?doc={did}&part={part}&print=1")
    page.wait_for_function("window.__paperReady === true", timeout=30000)
    rep = page.evaluate("window.__paperReport")
    page.pdf(path=str(pdf_path), prefer_css_page_size=True, print_background=True)
    return rep


def raster(pdf: Path, prefix: Path, first: int = 1, last: int = 4, dpi: int = 50) -> list[Path]:
    subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-f", str(first), "-l", str(last), str(pdf), str(prefix)], check=True)
    return sorted(prefix.parent.glob(prefix.name + "-*.png"))


def sheet(columns: list[tuple[str, list[Path]]], out: Path):
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    ims = [(label, [Image.open(p).convert("RGB") for p in paths]) for label, paths in columns]
    h = max((im.height for _, col in ims for im in col), default=400) + 36
    w = sum(im.width + 8 for _, col in ims for im in col) + 24 * len(ims)
    c = Image.new("RGB", (w, h), (214, 210, 202))
    d = ImageDraw.Draw(c)
    x = 8
    for label, col in ims:
        d.text((x, 8), label, fill=(30, 30, 30), font=font)
        for im in col:
            c.paste(im, (x, 32)); x += im.width + 8
        x += 24
    c.save(out)


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    inputs = make_inputs.make_all(OUT / "inputs")
    fx = OUT / "fixtures"; fx.mkdir()
    data = OUT / "data"
    srv = start_backend(data, fx)
    results = []
    from playwright.sync_api import sync_playwright
    try:
        with sync_playwright() as pw:
            chrome = os.environ.get("CHALK_CHROME")  # a Chrome to use instead of Playwright's own
            browser = pw.chromium.launch(executable_path=chrome or None, args=["--no-sandbox"])
            page = browser.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            for name, (raw, files) in make_replies.SCENARIOS.items():
                res: dict = {"scenario": name, "files": files, "problems": []}
                ids = {}
                for f in files:
                    up = requests.post(f"{BASE}/api/uploads", files={"file": (f, (inputs / f).read_bytes())}, timeout=60)
                    up.raise_for_status()
                    ids[f] = up.json()["id"]
                text = raw
                for f, uid in ids.items():
                    text = text.replace("{{upload:%s}}" % f, uid)
                (fx / f"{name}.txt").write_text(text, "utf-8")
                note = requests.post(f"{BASE}/api/notes", json={}, timeout=10).json()
                t0 = time.perf_counter()
                result = turn(f"{ASK[name]} fixture:{name}", note["id"], list(ids.values()))
                res["turn_s"] = round(time.perf_counter() - t0, 2)
                # What Claude would have been sent.
                lp = json.loads((data / "last_prompt.json").read_text())
                res["images_sent"] = lp["images"]
                res["prompt_kb"] = round(len(lp["prompt"]) / 1024, 1)
                for f in ids:
                    if f not in lp["prompt"]:
                        res["problems"].append(f"{f} missing from the prompt")
                if ids and "make every question and figure new" not in lp["prompt"]:
                    res["problems"].append("the prompt doesn't ask for new questions and figures")
                if files and not lp["images"]:
                    res["problems"].append("no page images sent")
                if any(f.endswith(".pdf") and f != "scanned_worksheet.pdf" for f in files) and "[page 1 text]" not in lp["prompt"]:
                    res["problems"].append("no extracted text sent")
                # The saved note shows the files on your message.
                turns = requests.get(f"{BASE}/api/notes/{note['id']}", timeout=10).json()["turns"]
                user = next(t for t in turns if t["role"] == "user")
                if files and [x["name"] for x in user["data"].get("files", [])] != files:
                    res["problems"].append("files not saved on the message")
                doc = result.get("document")
                res["doc_error"] = result.get("doc_error")
                if name == "truncated":
                    if doc or not res["doc_error"]:
                        res["problems"].append("a cut-off document should be reported, not shown")
                    results.append(res)
                    continue
                if not doc:
                    res["problems"].append(f"no document came through ({res['doc_error']})")
                    results.append(res)
                    continue
                res["summary"] = doc["summary"]
                full = requests.get(f"{BASE}/api/docs/{doc['id']}", timeout=10).json()["doc"]
                if "upload" in json.dumps(full):
                    res["problems"].append("a figure from the student's file got through")
                # Every multiple-choice question must come with its options, and they must print.
                mcq_missing = [i + 1 for i, q in enumerate(full.get("questions", [])) if "section" not in q
                               and any(w in q.get("text", "") for w in ("Which of the following", "Which set", "Select one", "Indicate which"))
                               and not q.get("answer", {}).get("choices")]
                if mcq_missing:
                    res["problems"].append(f"multiple-choice questions without options: {mcq_missing}")
                if name == "reuse_refused" and "figures" in full["questions"][0]:
                    res["problems"].append("the reused figure wasn't dropped")
                cols = []
                for f in files[:2]:
                    p = inputs / f
                    if p.suffix == ".pdf":
                        cols.append((f"Your file: {f}", raster(p, OUT / f"{name}_in_{p.stem}", 1, 2, 40)))
                    else:
                        im = Image.open(p); im.thumbnail((330, 468)); ip = OUT / f"{name}_in_{p.stem}.png"; im.save(ip)
                        cols.append((f"Your file: {f}", [ip]))
                for part in ("paper", "scheme"):
                    pdf = OUT / f"{name}_{part}.pdf"
                    errors.clear()
                    rep = render(page, doc["id"], part, pdf)
                    res[part] = rep
                    for k in ("clipped", "emptyPages"):
                        if rep[k]:
                            res["problems"].append(f"{part}: {k} {rep[k]}")
                    if part == "paper" and len(rep.get("figureErrors", [])) != EXPECT_FIGURE_ERRORS.get(name, 0):
                        res["problems"].append(f"figure errors: {rep.get('figureErrors')}")
                    if rep["brokenImages"]:
                        res["problems"].append(f"{part}: {rep['brokenImages']} broken images")
                    if part == "paper" and name == "ipcv_follow":
                        page.goto(f"{BASE}/paper.html?doc={doc['id']}&part=paper&print=1")
                        page.wait_for_function("window.__paperReady === true", timeout=30000)
                        n_opts = page.evaluate("document.querySelectorAll('.choices.list .choice').length")
                        if n_opts != 5 + 5 + 5 + 5 + 4 + 5:
                            res["problems"].append(f"expected 29 printed options, found {n_opts}")
                    if rep.get("rawTex") and name != "stress":
                        res["problems"].append(f"{part}: maths left as raw text: {rep['rawTex'][:3]}")
                    if rep["katexErrors"] and name != "stress":
                        res["problems"].append(f"{part}: {rep['katexErrors']} maths errors")
                    if errors:
                        res["problems"].append(f"{part}: page errors {errors[:2]}")
                    cols.append((("Chalk: paper" if part == "paper" else "Chalk: " + ("mark scheme" if doc["kind"] == "paper" else "answers")),
                                 raster(pdf, OUT / f"{name}_{part}", 1, 4 if part == "paper" else 1, 40)))
                sheet(cols, OUT / f"sheet_{name}.png")
                results.append(res)
            browser.close()
    finally:
        srv.terminate()
    (OUT / "results.json").write_text(json.dumps(results, indent=1))
    bad = 0
    for r in results:
        ok = not r["problems"]
        bad += not ok
        pages = f"{r.get('paper', {}).get('pages', '-')}+{r.get('scheme', {}).get('pages', '-')}pp"
        figs = r.get("paper", {}).get("figures", "-")
        print(f"{'PASS' if ok else 'FAIL'}  {r['scenario']:<20} {pages:<8} figs={figs!s:<3} imgs={r['images_sent']:<3} prompt={r['prompt_kb']:>6} KB  {r.get('summary') or r.get('doc_error') or ''}")
        for p in r["problems"]:
            print("      -", p)
    print(f"\n{len(results) - bad}/{len(results)} scenarios passed · sheets in {OUT}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
