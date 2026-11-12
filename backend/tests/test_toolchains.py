"""Downloading and finding Java and C, using local stand-ins for the download sites."""
import io
import sys
import tarfile
import time
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import toolchains  # noqa: E402

EXE = toolchains.EXE


def wait(lang, timeout=20):
    t0 = time.time()
    while toolchains.progress.get(lang, {}).get("phase") in ("downloading", "unpacking"):
        assert time.time() - t0 < timeout
        time.sleep(0.05)
    return toolchains.progress[lang]


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("CHALK_TOOLCHAINS", str(tmp_path / "tc"))
    monkeypatch.setattr(toolchains, "MIRRORS", {})
    toolchains.forget()
    toolchains.progress.clear()
    yield tmp_path
    toolchains.forget()


def script(body: str) -> bytes:
    return f"#!/bin/sh\n{body}\n".encode()


def make_zip(path: Path, files: dict[str, bytes]):
    with zipfile.ZipFile(path, "w") as z:
        for name, data in files.items():
            info = zipfile.ZipInfo(name)
            info.external_attr = 0o755 << 16
            z.writestr(info, data)


def test_install_c_from_a_zip_then_remove(home, monkeypatch):
    archive = home / "tcc.zip"
    make_zip(archive, {f"tcc/tcc{EXE}": script("echo tcc version 0.9.27"), "tcc/include/stdio.h": b""})
    monkeypatch.setattr(toolchains, "download_url", lambda lang: archive.as_uri())
    monkeypatch.setattr(toolchains, "find_c", toolchains.find_c)
    # pretend there is no system compiler so the downloaded one is what's found
    monkeypatch.setattr(toolchains.shutil, "which", lambda name: None)
    toolchains.install("c")
    p = wait("c")
    assert p["phase"] == "done", p
    found = toolchains.cc()
    assert found["source"] == "chalk" and found["kind"] == "tcc"
    st = {s["id"]: s for s in toolchains.status()}
    assert st["c"]["state"] == "ready" and "downloaded by Chalk" in st["c"]["detail"]
    toolchains.remove("c")
    assert toolchains.cc() is None and not (home / "tc" / "c").exists()
    assert {s["id"]: s for s in toolchains.status()}["c"]["state"] == "missing"


def test_install_java_from_a_tarball(home, monkeypatch):
    archive = home / "jdk.tar.gz"
    with tarfile.open(archive, "w:gz") as t:
        for name in (f"jdk-21/bin/javac{EXE}", f"jdk-21/bin/java{EXE}"):
            data = script("echo javac 21.0.5")
            ti = tarfile.TarInfo(name); ti.size = len(data); ti.mode = 0o755
            t.addfile(ti, io.BytesIO(data))
    monkeypatch.setattr(toolchains, "download_url", lambda lang: archive.as_uri())
    monkeypatch.delenv("JAVA_HOME", raising=False)
    monkeypatch.setattr(toolchains.shutil, "which", lambda name: None)
    toolchains.install("java")
    assert wait("java")["phase"] == "done"
    j = toolchains.java()
    assert j["source"] == "chalk" and j["version"] == "javac 21.0.5"


def test_failed_download_is_explained(home, monkeypatch):
    monkeypatch.setattr(toolchains, "download_url", lambda lang: (home / "nope.zip").as_uri())
    toolchains.install("c")
    p = wait("c")
    assert p["phase"] == "error" and p["error"]
    assert {s["id"]: s for s in toolchains.status()}["c"]["state"] == "error"


def test_archive_without_the_compiler_is_rejected(home, monkeypatch):
    archive = home / "wrong.zip"
    make_zip(archive, {"readme.txt": b"hello"})
    monkeypatch.setattr(toolchains, "download_url", lambda lang: archive.as_uri())
    monkeypatch.setattr(toolchains.shutil, "which", lambda name: None)
    toolchains.install("c")
    p = wait("c")
    assert p["phase"] == "error" and "expected" in p["error"]


def test_unsafe_paths_in_an_archive_are_refused(home, monkeypatch):
    archive = home / "evil.zip"
    make_zip(archive, {"../../outside.txt": b"x", f"tcc/tcc{EXE}": script("echo tcc")})
    monkeypatch.setattr(toolchains, "download_url", lambda lang: archive.as_uri())
    toolchains.install("c")
    p = wait("c")
    assert p["phase"] == "error" and "unsafe" in p["error"]
    assert not (home.parent / "outside.txt").exists()


def test_status_lists_every_language():
    ids = [s["id"] for s in toolchains.status()]
    assert ids == ["python", "javascript", "sql", "java", "c"]
    builtin = [s for s in toolchains.status() if s["state"] == "builtin"]
    assert {s["id"] for s in builtin} == {"python", "javascript", "sql"}


def test_download_urls():
    assert "api.adoptium.net/v3/binary/latest/21/ga/" in toolchains.download_url("java")
    assert toolchains.download_url("python") is None
