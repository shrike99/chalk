"""Files you give Claude: PDFs (past papers, worksheets, notes) and images.

PDFs are rendered to page images and their text is pulled out, so Claude sees the layout (to copy a
paper's format) and reads the words exactly (to get the content right). Everything stays on your PC
under <data>/uploads/<id>/.
"""
from __future__ import annotations

import io
import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

MAX_BYTES = 60 * 1024 * 1024
MAX_PAGES = 80                 # rendered and readable; more than this is almost never a single paper
PAGE_LONG_EDGE = 1400          # px: past-paper small print stays legible, about 1.6k tokens a page
IMAGE_LONG_EDGE = 1568         # Claude's own limit; bigger images are scaled down anyway
SEND_PAGE_BUDGET = 18          # page images sent with one message, across all attached PDFs
TEXT_BUDGET = 60_000           # characters of extracted text sent with one message
IMAGE_TYPES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


class UploadError(Exception):
    pass


class Uploads:
    def __init__(self, root: Path):
        self.root = root
        root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ store
    def add(self, name: str, data: bytes) -> dict:
        if len(data) > MAX_BYTES:
            raise UploadError(f"{name} is larger than {MAX_BYTES // 2**20} MB.")
        ext = Path(name).suffix.lower()
        is_pdf = ext == ".pdf" or data[:5] == b"%PDF-"
        if not is_pdf and ext not in IMAGE_TYPES:
            raise UploadError(f"Chalk can read PDFs and images (PNG, JPG, WebP, GIF), not {ext or 'that file'}.")
        uid = uuid.uuid4().hex[:12]
        d = self.root / uid
        d.mkdir()
        try:
            meta = self._pdf(d, name, data) if is_pdf else self._image(d, name, data)
        except UploadError:
            _rmtree(d)
            raise
        except Exception as e:
            _rmtree(d)
            raise UploadError(f"Couldn't read {name}: {e}") from e
        meta |= {"id": uid, "name": name, "size": len(data), "created": time.time()}
        (d / "meta.json").write_text(json.dumps(meta), "utf-8")
        return meta

    def _image(self, d: Path, name: str, data: bytes) -> dict:
        try:
            im = Image.open(io.BytesIO(data))
            im = ImageOps.exif_transpose(im)  # phone photos
        except Exception as e:
            raise UploadError(f"{name} doesn't look like an image.") from e
        im = _fit(im.convert("RGBA") if im.mode in ("P", "LA", "RGBA") else im.convert("RGB"), IMAGE_LONG_EDGE)
        if im.mode == "RGBA":  # flatten onto white: transparent screenshots read badly
            bg = Image.new("RGB", im.size, "white")
            bg.paste(im, mask=im.split()[3])
            im = bg
        im.save(d / "p1.png", optimize=True)
        _thumb(im).save(d / "thumb.png")
        return {"kind": "image", "pages": 1, "width": im.width, "height": im.height, "text": []}

    def _pdf(self, d: Path, name: str, data: bytes) -> dict:
        import pypdfium2 as pdfium
        try:
            pdf = pdfium.PdfDocument(data)
        except Exception as e:
            msg = str(e).lower()
            if "password" in msg:
                raise UploadError(f"{name} is password-protected. Save an unlocked copy and try again.") from e
            raise UploadError(f"{name} doesn't look like a valid PDF.") from e
        n = len(pdf)
        if n == 0:
            raise UploadError(f"{name} has no pages.")
        (d / "original.pdf").write_bytes(data)
        texts = []
        for i in range(min(n, MAX_PAGES)):
            page = pdf[i]
            w, h = page.get_size()
            scale = PAGE_LONG_EDGE / max(w, h)
            im = page.render(scale=scale).to_pil().convert("RGB")
            im.save(d / f"p{i + 1}.png", optimize=True)
            if i == 0:
                _thumb(im).save(d / "thumb.png")
            try:
                tp = page.get_textpage()
                texts.append(_tidy(tp.get_text_range()))
                tp.close()
            except Exception:
                texts.append("")
            page.close()
        pdf.close()
        # A scan or photo has no text layer at all; a page that's mostly diagram still has a few words.
        scanned = sum(1 for t in texts if len(t.strip()) < 15) >= max(1, 0.8 * len(texts))
        return {"kind": "pdf", "pages": min(n, MAX_PAGES), "total_pages": n, "text": texts, "scanned": scanned}

    def meta(self, uid: str) -> dict | None:
        if not re.fullmatch(r"[0-9a-f]{12}", uid or ""):
            return None
        try:
            return json.loads((self.root / uid / "meta.json").read_text("utf-8"))
        except (OSError, ValueError):
            return None

    def public(self, m: dict) -> dict:
        """What the app needs to show a file (no extracted text)."""
        return {k: m[k] for k in ("id", "name", "kind", "pages", "size") if k in m} | (
            {"total_pages": m["total_pages"]} if m.get("total_pages", 0) > m.get("pages", 0) else {})

    def page_path(self, uid: str, n: int) -> Path | None:
        m = self.meta(uid)
        if not m or not 1 <= n <= m["pages"]:
            return None
        return self.root / uid / f"p{n}.png"

    def delete(self, uid: str) -> None:
        if self.meta(uid):
            _rmtree(self.root / uid)

    def page_images(self, uid: str, pages: list[int], limit: int = 6) -> list[str]:
        """Particular pages again, as data URLs (when Claude asks to look at them a second time)."""
        import base64
        out = []
        for n in pages[:limit]:
            p = self.page_path(uid, int(n))
            if p and p.exists():
                out.append("data:image/png;base64," + base64.b64encode(p.read_bytes()).decode())
        return out

    # ------------------------------------------------------------ for Claude
    def for_claude(self, ids: list[str]) -> tuple[str, list[str]]:
        """(text to add to the prompt, page images as data URLs) for the files attached to a message.

        Every page's text goes in (up to TEXT_BUDGET). Page images are shared out across the PDFs,
        always including each one's first pages (cover, instructions, the first questions: where a
        paper's format shows most) and its last page (often the mark scheme or formula sheet).
        """
        import base64
        metas = [m for m in (self.meta(i) for i in ids) if m]
        if not metas:
            return "", []
        pdfs = [m for m in metas if m["kind"] == "pdf"]
        imgs = [m for m in metas if m["kind"] == "image"]
        budget = max(SEND_PAGE_BUDGET - len(imgs), len(pdfs))
        per = max(1, budget // max(1, len(pdfs)))
        lines = ["", "ATTACHED FILES (the student uploaded these with this message; they stay available in this note).",
                 "If you write a paper from them, copy their format but make every question and figure new.",
                 'These pages are sent this once: add "files_digest" to your notes json (see "Keeping the conversation light").']
        images: list[str] = []
        text_left = TEXT_BUDGET

        def add_image(path: Path):
            images.append("data:image/png;base64," + base64.b64encode(path.read_bytes()).decode())

        for m in metas:
            if m["kind"] == "image":
                lines.append(f'- Image "{m["name"]}": shown as image {len(images) + 1}.')
                add_image(self.root / m["id"] / "p1.png")
                continue
            pages = _pick_pages(m["pages"], per)
            first = len(images) + 1
            for p in pages:
                add_image(self.root / m["id"] / f"p{p}.png")
            shown = ", ".join(map(str, pages))
            more = f" (the file has {m['total_pages']} pages; only the first {m['pages']} were read)" if m.get("total_pages", 0) > m["pages"] else ""
            lines.append(f'- PDF "{m["name"]}", {m["pages"]} pages{more}. '
                         f"Pages {shown} are shown as images {first}–{len(images)}.")
            if m.get("scanned"):
                lines.append("  It's a scan or photo with no text layer: read it from the page images.")
            for i, t in enumerate(m["text"], 1):
                if not t.strip() or text_left <= 0:
                    continue
                chunk = t[:text_left]
                text_left -= len(chunk)
                lines.append(f"  [page {i} text]\n{_indent(chunk)}")
            if text_left <= 0:
                lines.append("  (text cut short: the rest is too long to send)")
        return "\n".join(lines) + "\n", images


def _pick_pages(n: int, k: int) -> list[int]:
    if n <= k:
        return list(range(1, n + 1))
    head = list(range(1, min(n, max(2, k - 2)) + 1))  # cover + the first question pages
    rest = k - len(head)
    tail = [n] if rest >= 1 else []
    rest -= len(tail)
    mid_lo, mid_hi = len(head) + 1, n - 1
    mid = []
    if rest > 0 and mid_hi >= mid_lo:
        step = (mid_hi - mid_lo + 1) / (rest + 1)
        mid = sorted({round(mid_lo - 1 + step * (j + 1)) for j in range(rest)})
    return sorted(set(head + mid + tail))


def _fit(im: Image.Image, edge: int) -> Image.Image:
    if max(im.size) > edge:
        im = im.copy()
        im.thumbnail((edge, edge), Image.LANCZOS)
    return im


def _thumb(im: Image.Image) -> Image.Image:
    t = im.convert("RGB").copy()
    t.thumbnail((240, 240), Image.LANCZOS)
    return t


def _tidy(t: str) -> str:
    t = t.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    t = re.sub(r"[ \t]+\n", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()[:12000]


def _indent(t: str) -> str:
    return "\n".join("    " + ln for ln in t.splitlines())


def _rmtree(p: Path) -> None:
    import shutil
    shutil.rmtree(p, ignore_errors=True)
