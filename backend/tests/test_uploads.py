"""Files you give Claude: reading PDFs and images, awkward files, and what goes into the prompt."""
import base64
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from uploads import Uploads, UploadError, _pick_pages, SEND_PAGE_BUDGET  # noqa: E402


@pytest.fixture(scope="session")
def inputs(tmp_path_factory):
    import make_inputs
    return make_inputs.make_all(tmp_path_factory.mktemp("inputs"))


@pytest.fixture()
def store(tmp_path):
    return Uploads(tmp_path / "uploads")


def add(store, inputs, name):
    return store.add(name, (inputs / name).read_bytes())


def test_pdf_pages_and_text(store, inputs):
    m = add(store, inputs, "gcse_maths_style.pdf")
    assert m["kind"] == "pdf" and m["pages"] == 3 and not m["scanned"]
    assert "Centre number" in m["text"][0] and "Expand and simplify" in m["text"][2]
    im = Image.open(store.page_path(m["id"], 1))
    assert max(im.size) == 1400 and im.width < im.height          # A4 portrait at the size Claude reads well
    assert (store.root / m["id"] / "thumb.png").exists()
    assert store.public(m) == {"id": m["id"], "name": "gcse_maths_style.pdf", "kind": "pdf", "pages": 3, "size": m["size"]}


def test_scanned_pdf_is_flagged(store, inputs):
    m = add(store, inputs, "scanned_worksheet.pdf")
    assert m["scanned"] and m["pages"] == 1
    note, imgs = store.for_claude([m["id"]])
    assert "scan or photo" in note and len(imgs) == 1


def test_photo(store, inputs):
    m = add(store, inputs, "velocity_graph_photo.jpg")
    assert m["kind"] == "image" and m["pages"] == 1
    note, imgs = store.for_claude([m["id"]])
    assert 'Image "velocity_graph_photo.jpg"' in note and imgs[0].startswith("data:image/png;base64,")
    assert "make every question and figure new" in note


def test_transparent_png_is_flattened(store, inputs):
    m = add(store, inputs, "transparent.png")
    im = Image.open(store.page_path(m["id"], 1))
    assert im.mode == "RGB" and im.getpixel((5, 5)) == (255, 255, 255)


def test_big_image_is_scaled(store):
    buf = io.BytesIO()
    Image.new("RGB", (5000, 3000), "white").save(buf, "PNG")
    m = store.add("huge.png", buf.getvalue())
    assert (m["width"], m["height"]) == (1568, 941)


@pytest.mark.parametrize("name,msg", [("locked.pdf", "password"), ("corrupt.pdf", "valid PDF"), ("notes.docx", "PDFs and images")])
def test_awkward_files(store, inputs, name, msg):
    with pytest.raises(UploadError, match=msg):
        add(store, inputs, name)
    assert not any(store.root.iterdir())   # nothing half-written left behind


def test_not_an_image(store):
    with pytest.raises(UploadError, match="doesn't look like an image"):
        store.add("fake.png", b"hello")


def test_long_pdf_page_choice(store, inputs):
    m = add(store, inputs, "long_paper_40pp.pdf")
    assert m["pages"] == 40
    note, imgs = store.for_claude([m["id"]])
    assert len(imgs) == SEND_PAGE_BUDGET
    shown = note.split("Pages ")[1].split(" are shown")[0]
    pages = [int(x) for x in shown.split(", ")]
    assert pages[:6] == [1, 2, 3, 4, 5, 6] and pages[-1] == 40     # the cover and first questions, and the end
    assert "[page 40 text]" in note and "Mark scheme" in note       # every page's text is there


def test_page_choice_edges():
    assert _pick_pages(3, 18) == [1, 2, 3]
    assert _pick_pages(10, 1) == [1, 2]                              # never less than the cover + one page
    for n in (5, 19, 40, 80):
        for k in (2, 5, 9, 18):
            p = _pick_pages(n, k)
            assert p == sorted(set(p)) and p[0] == 1 and all(1 <= x <= n for x in p)
            assert len(p) <= max(k, 2)


def test_several_files_share_the_budget(store, inputs):
    ids = [add(store, inputs, n)["id"] for n in ("long_paper_40pp.pdf", "university_exam.pdf", "gcse_maths_style.pdf", "velocity_graph_photo.jpg")]
    note, imgs = store.for_claude(ids)
    assert len(imgs) <= SEND_PAGE_BUDGET
    for n in ("long_paper_40pp.pdf", "university_exam.pdf", "gcse_maths_style.pdf", "velocity_graph_photo.jpg"):
        assert n in note
    assert "Answer THREE of the FOUR questions" in note


def test_ids_are_checked(store):
    for bad in ("../../etc", "", "0123", "ZZZZZZZZZZZZ"):
        assert store.meta(bad) is None and store.page_path(bad, 1) is None


def test_delete(store, inputs):
    m = add(store, inputs, "gcse_maths_style.pdf")
    store.delete(m["id"])
    assert store.meta(m["id"]) is None
