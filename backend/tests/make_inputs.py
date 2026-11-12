"""Make the "past papers" the assessment tests upload: deliberately in formats unlike Chalk's own.

python backend/tests/make_inputs.py <out dir>     (needs reportlab, pillow, pypdf: test-only)
"""
import random
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

W, H = A4
OUT = Path(tempfile.gettempdir()) / "chalk-inputs"


def make_all(out: Path) -> Path:
    global OUT
    OUT = out
    out.mkdir(parents=True, exist_ok=True)
    gcse(); university(); mcq(); interview(); scanned(); graph_photo(); awkward()
    return out


def lines(c, x, y, n, w=150 * mm, gap=9 * mm):
    c.setDash(1, 2)
    for i in range(n):
        c.line(x, y - i * gap, x + w, y - i * gap)
    c.setDash()
    return y - n * gap


def para(c, text, x, y, font="Helvetica", size=11, lead=15, width=95):
    import textwrap
    c.setFont(font, size)
    for ln in textwrap.wrap(text, width):
        c.drawString(x, y, ln)
        y -= lead
    return y


# ---------------------------------------------------------------- 1. GCSE-style maths paper
def gcse():
    c = canvas.Canvas(str(OUT / "gcse_maths_style.pdf"), pagesize=A4)
    c.setFillGray(0.15); c.rect(0, H - 38 * mm, W, 38 * mm, fill=1, stroke=0); c.setFillGray(1)
    c.setFont("Helvetica-Bold", 20); c.drawString(20 * mm, H - 22 * mm, "GCSE MATHEMATICS")
    c.setFont("Helvetica", 12); c.drawString(20 * mm, H - 31 * mm, "Higher Tier   Paper 1 Non-Calculator")
    c.setFillGray(0)
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, H - 52 * mm, "Centre number"); c.drawString(95 * mm, H - 52 * mm, "Candidate number")
    for i in range(5):
        c.rect(20 * mm + i * 8 * mm, H - 64 * mm, 8 * mm, 9 * mm)
    for i in range(4):
        c.rect(95 * mm + i * 8 * mm, H - 64 * mm, 8 * mm, 9 * mm)
    c.drawString(20 * mm, H - 76 * mm, "Surname ____________________________   Forename(s) ____________________________")
    c.setFont("Helvetica-Bold", 12); c.drawString(20 * mm, H - 92 * mm, "Time allowed: 1 hour 30 minutes")
    c.setFont("Helvetica-Bold", 11); c.drawString(20 * mm, H - 108 * mm, "Instructions")
    y = H - 115 * mm
    for t in ["Use black ink or black ball-point pen. Draw diagrams in pencil.", "Fill in the boxes at the top of this page.",
              "Answer all questions.", "You must answer the questions in the space provided.", "Do all rough work in this book.",
              "In all calculations, show clearly how you work out your answer."]:
        c.setFont("Helvetica", 10); c.drawString(24 * mm, y, "•  " + t); y -= 6 * mm
    c.setFont("Helvetica-Bold", 11); c.drawString(20 * mm, y - 4 * mm, "Information"); y -= 11 * mm
    for t in ["The marks for questions are shown in brackets.", "The maximum mark for this paper is 80.", "You may not use a calculator."]:
        c.setFont("Helvetica", 10); c.drawString(24 * mm, y, "•  " + t); y -= 6 * mm
    c.setFont("Helvetica-Bold", 10); c.drawString(140 * mm, 60 * mm, "For Examiner's Use")
    c.rect(140 * mm, 20 * mm, 50 * mm, 38 * mm)
    c.drawRightString(190 * mm, 10 * mm, "Turn over ►")
    c.showPage()
    # questions
    c.setFont("Helvetica-Bold", 14); c.drawString(15 * mm, H - 25 * mm, "1")
    y = para(c, "Work out 3/4 + 2/5. Give your answer as a mixed number.", 28 * mm, H - 25 * mm)
    y = lines(c, 28 * mm, y - 10 * mm, 4)
    c.setFont("Helvetica", 10); c.drawString(120 * mm, y - 2 * mm, "Answer ____________________")
    c.setFont("Helvetica-Bold", 10); c.drawRightString(195 * mm, y - 9 * mm, "(2 marks)")
    c.line(15 * mm, y - 14 * mm, 195 * mm, y - 14 * mm)
    y -= 26 * mm
    c.setFont("Helvetica-Bold", 14); c.drawString(15 * mm, y, "2")
    y = para(c, "ABC is a right-angled triangle. AB = 6 cm and BC = 8 cm. Work out the length of AC.", 28 * mm, y)
    c.line(60 * mm, y - 50 * mm, 120 * mm, y - 50 * mm); c.line(60 * mm, y - 50 * mm, 60 * mm, y - 10 * mm); c.line(60 * mm, y - 10 * mm, 120 * mm, y - 50 * mm)
    c.setFont("Helvetica", 10); c.drawString(55 * mm, y - 30 * mm, "6 cm"); c.drawString(86 * mm, y - 56 * mm, "8 cm")
    c.drawString(55 * mm, y - 8 * mm, "A"); c.drawString(55 * mm, y - 54 * mm, "B"); c.drawString(122 * mm, y - 54 * mm, "C")
    c.drawString(120 * mm, y - 78 * mm, "Answer ____________________ cm")
    c.setFont("Helvetica-Bold", 10); c.drawRightString(195 * mm, y - 86 * mm, "(3 marks)")
    c.drawRightString(190 * mm, 10 * mm, "Turn over ►")
    c.showPage()
    c.setFont("Helvetica-Bold", 14); c.drawString(15 * mm, H - 25 * mm, "3")
    y = para(c, "(a)  Expand and simplify (x + 5)(x - 3)", 28 * mm, H - 25 * mm)
    y = lines(c, 28 * mm, y - 8 * mm, 3)
    c.setFont("Helvetica-Bold", 10); c.drawRightString(195 * mm, y - 4 * mm, "(2 marks)")
    y = para(c, "(b)  Factorise fully 6x² - 9x", 28 * mm, y - 16 * mm)
    y = lines(c, 28 * mm, y - 8 * mm, 2)
    c.setFont("Helvetica", 10); c.drawString(120 * mm, y - 2 * mm, "Answer ____________________")
    c.setFont("Helvetica-Bold", 10); c.drawRightString(195 * mm, y - 9 * mm, "(2 marks)")
    c.drawRightString(190 * mm, 10 * mm, "Turn over ►")
    c.save()


# ---------------------------------------------------------------- 2. University exam (serif, booklet answers)
def university():
    c = canvas.Canvas(str(OUT / "university_exam.pdf"), pagesize=A4)
    c.setFont("Times-Bold", 13); c.drawCentredString(W / 2, H - 25 * mm, "UNIVERSITY OF EXAMPLE")
    c.setFont("Times-Roman", 12); c.drawCentredString(W / 2, H - 32 * mm, "School of Computer Science")
    c.setFont("Times-Bold", 14); c.drawCentredString(W / 2, H - 46 * mm, "CS2002: Algorithms and Data Structures")
    c.setFont("Times-Roman", 12); c.drawCentredString(W / 2, H - 54 * mm, "Summer Examinations 2025      Time allowed: TWO hours")
    c.setFont("Times-Italic", 12)
    c.drawCentredString(W / 2, H - 68 * mm, "Answer THREE of the FOUR questions. All questions carry equal marks.")
    c.drawCentredString(W / 2, H - 75 * mm, "Write your answers in the answer booklet provided.")
    c.line(25 * mm, H - 82 * mm, W - 25 * mm, H - 82 * mm)
    y = H - 95 * mm
    for qn, parts in ((1, [("1.1", "Define the amortised cost of an operation and explain how the potential method is used to bound it.", 6),
                           ("1.2", "A dynamic array doubles its capacity when full. Show that n appends cost O(n) in total.", 8),
                           ("1.3", "Suppose the array instead grows by a constant k. What is the total cost of n appends? Justify your answer.", 6),
                           ("1.4", "Give one practical reason a library might still choose a growth factor of 1.5 rather than 2.", 5)]),
                      (2, [("2.1", "State the invariant maintained by Dijkstra's algorithm.", 4),
                           ("2.2", "Explain, with a counterexample, why Dijkstra's algorithm fails with negative edge weights.", 9),
                           ("2.3", "Describe how Bellman-Ford detects a negative cycle and state its running time.", 12)])):
        c.setFont("Times-Bold", 13); c.drawString(25 * mm, y, f"Question {qn}"); y -= 9 * mm
        for lab, txt, mk in parts:
            c.setFont("Times-Bold", 12); c.drawString(25 * mm, y, lab)
            y2 = para(c, txt, 37 * mm, y, font="Times-Roman", size=12, lead=15, width=78)
            c.setFont("Times-Roman", 12); c.drawRightString(W - 25 * mm, y2 + 1, f"[{mk} marks]")
            y = y2 - 8 * mm
        y -= 6 * mm
        if y < 70 * mm:
            c.setFont("Times-Roman", 10); c.drawCentredString(W / 2, 12 * mm, "Page 1 of 2 · Continued overleaf")
            c.showPage(); y = H - 25 * mm
    c.setFont("Times-Roman", 10); c.drawCentredString(W / 2, 12 * mm, "Page 2 of 2 · END OF PAPER")
    c.save()


# ---------------------------------------------------------------- 3. Multiple choice physics with a circuit
def mcq():
    c = canvas.Canvas(str(OUT / "mcq_physics.pdf"), pagesize=A4)
    c.setFont("Helvetica-Bold", 16); c.drawString(20 * mm, H - 24 * mm, "Section A")
    c.setFont("Helvetica", 11); c.drawString(20 * mm, H - 32 * mm, "Answer all questions in this section. Each question is worth 1 mark.")
    c.drawString(20 * mm, H - 39 * mm, "For each question, completely fill in the circle next to your answer.")
    y = H - 56 * mm
    qs = [("0 1", "Which quantity is a vector?", ["Speed", "Mass", "Momentum", "Energy"]),
          ("0 2", "The diagram shows a circuit. What is the reading on the ammeter?", ["0.5 A", "1.0 A", "2.0 A", "4.0 A"]),
          ("0 3", "What is the unit of specific heat capacity?", ["J/kg", "J/kg °C", "J °C", "kg/J °C"])]
    for num, text, opts in qs:
        c.setFont("Helvetica-Bold", 12); c.rect(20 * mm, y - 2 * mm, 12 * mm, 7 * mm); c.drawString(22 * mm, y, num)
        c.setFont("Helvetica", 11); c.drawString(36 * mm, y, text)
        y -= 10 * mm
        if num == "0 2":  # circuit: cell, resistor, ammeter
            x0, y0 = 60 * mm, y - 40 * mm
            c.rect(x0, y0, 70 * mm, 35 * mm)
            c.setFillGray(1); c.rect(x0 + 25 * mm, y0 + 32 * mm, 20 * mm, 6 * mm, fill=1); c.setFillGray(0)
            c.drawString(x0 + 30 * mm, y0 + 40 * mm, "6 Ω")
            c.setFillGray(1); c.circle(x0 + 70 * mm, y0 + 17 * mm, 5 * mm, fill=1); c.setFillGray(0)
            c.drawCentredString(x0 + 70 * mm, y0 + 15.5 * mm, "A")
            c.setFillGray(1); c.rect(x0 + 30 * mm, y0 - 3 * mm, 8 * mm, 6 * mm, fill=1, stroke=0); c.setFillGray(0)
            c.line(x0 + 31 * mm, y0 - 4 * mm, x0 + 31 * mm, y0 + 4 * mm); c.setLineWidth(2.5)
            c.line(x0 + 36 * mm, y0 - 2 * mm, x0 + 36 * mm, y0 + 2 * mm); c.setLineWidth(1)
            c.drawString(x0 + 26 * mm, y0 - 9 * mm, "12 V")
            y = y0 - 16 * mm
        for i, o in enumerate(opts):
            c.drawString(36 * mm, y, "ABCD"[i]); c.drawString(44 * mm, y, o); c.circle(150 * mm, y + 1.2 * mm, 2.6 * mm)
            y -= 8 * mm
        y -= 8 * mm
    c.setFont("Helvetica", 9); c.drawCentredString(W / 2, 12 * mm, "IB/M/Jun25/8463/1F")
    c.showPage()
    c.setFont("Helvetica-Bold", 16); c.drawString(20 * mm, H - 24 * mm, "Section B")
    c.setFont("Helvetica", 11); c.drawString(20 * mm, H - 32 * mm, "Answer all questions in the spaces provided.")
    c.setFont("Helvetica-Bold", 12); c.rect(20 * mm, H - 50 * mm, 12 * mm, 7 * mm); c.drawString(22 * mm, H - 48 * mm, "0 4")
    c.setFont("Helvetica", 11); c.drawString(36 * mm, H - 48 * mm, "A student measured the temperature of water as it was heated. Complete the table.")
    tx, ty = 36 * mm, H - 60 * mm
    for r in range(4):
        for col in range(3):
            c.rect(tx + col * 35 * mm, ty - r * 9 * mm, 35 * mm, 9 * mm)
    c.drawString(tx + 3 * mm, ty + 3 * mm, "Time (s)"); c.drawString(tx + 38 * mm, ty + 3 * mm, "Energy (J)"); c.drawString(tx + 73 * mm, ty + 3 * mm, "Temp (°C)")
    c.setFont("Helvetica-Bold", 11); c.drawRightString(190 * mm, ty - 40 * mm, "[3 marks]")
    c.save()


# ---------------------------------------------------------------- 4. Coding interview sheet
def interview():
    c = canvas.Canvas(str(OUT / "coding_interview.pdf"), pagesize=A4)
    c.setFont("Helvetica-Bold", 18); c.drawString(20 * mm, H - 25 * mm, "Onsite Interview: Round 2")
    c.setFont("Helvetica", 11); c.drawString(20 * mm, H - 33 * mm, "45 minutes · 2 problems · talk through your approach before coding")
    y = H - 50 * mm
    for title, stmt, ex, cons in (
        ("Problem 1: Merge Intervals", "Given an array of intervals where intervals[i] = [start, end], merge all overlapping intervals and return an array of the non-overlapping intervals that cover all the intervals in the input.",
         ["Input: intervals = [[1,3],[2,6],[8,10],[15,18]]", "Output: [[1,6],[8,10],[15,18]]"], ["1 <= intervals.length <= 10^4", "0 <= start <= end <= 10^4"]),
        ("Problem 2: LRU Cache", "Design a data structure that follows the constraints of a Least Recently Used cache. Implement get(key) and put(key, value), each in O(1) average time.",
         ['cache = LRUCache(2); cache.put(1, 1); cache.put(2, 2)', "cache.get(1)  # returns 1", "cache.put(3, 3)  # evicts key 2"], ["1 <= capacity <= 3000", "At most 2 * 10^5 calls"])):
        c.setFont("Helvetica-Bold", 13); c.drawString(20 * mm, y, title); y -= 8 * mm
        y = para(c, stmt, 20 * mm, y, size=11, width=88) - 4 * mm
        c.setFont("Helvetica-Bold", 10); c.drawString(20 * mm, y, "Example"); y -= 6 * mm
        c.setFillGray(0.95); c.rect(20 * mm, y - (len(ex) - 1) * 5 * mm - 3 * mm, 170 * mm, len(ex) * 5 * mm + 4 * mm, fill=1, stroke=0); c.setFillGray(0)
        c.setFont("Courier", 10)
        for e in ex:
            c.drawString(23 * mm, y, e); y -= 5 * mm
        y -= 6 * mm
        c.setFont("Helvetica-Bold", 10); c.drawString(20 * mm, y, "Constraints"); y -= 6 * mm
        c.setFont("Courier", 10)
        for e in cons:
            c.drawString(24 * mm, y, "• " + e); y -= 5 * mm
        c.setFont("Helvetica-Oblique", 10); c.drawString(20 * mm, y - 3 * mm, "Follow-up: what if the input is a stream?"); y -= 20 * mm
    c.save()


# ---------------------------------------------------------------- 5. A scanned worksheet (image only, no text layer)
def scanned():
    im = Image.new("L", (1240, 1754), 248)
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
        fb = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
    except OSError:
        f = fb = ImageFont.load_default()
    d.text((100, 90), "Year 9 Science  —  Rates of reaction worksheet", font=fb, fill=20)
    d.text((100, 170), "Name: ______________________   Class: ______", font=f, fill=30)
    y = 260
    for i, q in enumerate(["Name two ways to increase the rate of a reaction.", "Why does a powder react faster than a lump?",
                           "Complete the table of results below.", "Sketch a graph of volume of gas against time."], 1):
        d.text((100, y), f"{i}. {q}", font=f, fill=25); y += 60
        if i == 3:
            for r in range(4):
                for col in range(3):
                    d.rectangle([140 + col * 300, y + r * 60, 140 + (col + 1) * 300, y + (r + 1) * 60], outline=40, width=2)
            d.text((160, y + 12), "Time (s)", font=f, fill=30); d.text((460, y + 12), "Volume (cm³)", font=f, fill=30)
            y += 280
        else:
            for _ in range(3):
                d.line([(140, y + 40), (1120, y + 40)], fill=150, width=2); y += 55
        y += 30
    im = im.rotate(1.2, fillcolor=235, expand=False).filter(ImageFilter.GaussianBlur(0.7))
    rnd = random.Random(3)
    px = im.load()
    for _ in range(25000):
        x, yy = rnd.randrange(im.width), rnd.randrange(im.height)
        px[x, yy] = max(0, px[x, yy] - rnd.randrange(40))
    im.convert("RGB").save(OUT / "scanned_worksheet.pdf", "PDF", resolution=150)


# ---------------------------------------------------------------- 6. A photo of a graph (for "make questions about this")
def graph_photo():
    im = Image.new("RGB", (1400, 1000), (245, 241, 230))
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)
    except OSError:
        f = ImageFont.load_default()
    ox, oy = 160, 860
    d.line([(ox, oy), (1300, oy)], fill=(30, 30, 60), width=4); d.line([(ox, oy), (ox, 90)], fill=(30, 30, 60), width=4)
    for i in range(0, 11):
        d.line([(ox + i * 110, oy), (ox + i * 110, oy + 12)], fill=(30, 30, 60), width=3)
        d.text((ox + i * 110 - 10, oy + 20), str(i * 2), font=f, fill=(30, 30, 60))
    for j in range(0, 7):
        d.line([(ox - 12, oy - j * 120), (ox, oy - j * 120)], fill=(30, 30, 60), width=3)
        d.text((ox - 60, oy - j * 120 - 15), str(j * 5), font=f, fill=(30, 30, 60))
    pts = [(0, 0), (4, 20), (10, 20), (14, 30), (20, 0)]
    xy = [(ox + x * 55, oy - v * 24) for x, v in pts]
    d.line(xy, fill=(20, 40, 160), width=7, joint="curve")
    d.text((620, 930), "time (s)", font=f, fill=(30, 30, 60)); d.text((20, 40), "velocity (m/s)", font=f, fill=(30, 30, 60))
    im = im.rotate(-2, fillcolor=(220, 215, 200), expand=True).resize((1300, 960))
    im.save(OUT / "velocity_graph_photo.jpg", quality=82)


# ---------------------------------------------------------------- 7. Awkward files
def awkward():
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    for p in PdfReader(str(OUT / "coding_interview.pdf")).pages:
        w.add_page(p)
    w.encrypt("secret")
    with open(OUT / "locked.pdf", "wb") as fh:
        w.write(fh)
    (OUT / "corrupt.pdf").write_bytes(b"%PDF-1.7\n1 0 obj << /Type /Catalog >>\ngarbage" * 20)
    (OUT / "notes.docx").write_bytes(b"PK\x03\x04 not really a docx")
    # A long paper: 40 pages, to check which pages Claude is shown.
    c = canvas.Canvas(str(OUT / "long_paper_40pp.pdf"), pagesize=A4)
    for p in range(1, 41):
        c.setFont("Helvetica-Bold", 30); c.drawString(30 * mm, H - 40 * mm, f"Page {p}")
        c.setFont("Helvetica", 12); c.drawString(30 * mm, H - 55 * mm, "Mark scheme" if p >= 36 else f"Question {p}: explain something.")
        c.showPage()
    c.save()
    Image.new("RGBA", (800, 400), (0, 0, 0, 0)).save(OUT / "transparent.png")


if __name__ == "__main__":
    out = make_all(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT)
    print("\n".join(sorted(p.name for p in out.iterdir())))
