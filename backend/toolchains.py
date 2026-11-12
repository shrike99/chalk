"""The languages Chalk can run, and the compilers/runtimes it needs for them.

Built in:  Python (Chalk's own), JavaScript (runs in the app), SQL (SQLite, part of Python).
Download:  Java (Eclipse Temurin JDK 21, ~190 MB) and C (TinyCC on Windows, under 1 MB).

A language you've installed yourself is found and used instead: a JDK on PATH or in JAVA_HOME, and
gcc, clang or tcc on PATH. Chalk's own downloads live in their own folder and can be removed from
Settings without touching anything else on the PC.
"""
from __future__ import annotations

import os
import platform
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

WIN = sys.platform == "win32"
EXE = ".exe" if WIN else ""


def root() -> Path:
    env = os.environ.get("CHALK_TOOLCHAINS")
    if env:
        return Path(env)
    data = os.environ.get("CHALK_DATA")
    return (Path(data).parent / "toolchains") if data else Path(__file__).with_name("toolchains")


LANGS = {
    "python": {"name": "Python", "builtin": True},
    "javascript": {"name": "JavaScript", "builtin": True},
    "sql": {"name": "SQL", "builtin": True},
    "java": {"name": "Java", "builtin": False, "size": "about 190 MB"},
    "c": {"name": "C", "builtin": False, "size": "under 1 MB" if WIN else ""},
}


def _arch() -> str:
    m = platform.machine().lower()
    return "aarch64" if m in ("arm64", "aarch64") else "x64"


def _os() -> str:
    return "windows" if WIN else "mac" if sys.platform == "darwin" else "linux"


def download_url(lang: str) -> str | None:
    override = os.environ.get(f"CHALK_TOOLCHAIN_URL_{lang.upper()}")  # tests and offline mirrors
    if override:
        return override
    if lang == "java":
        # Adoptium's API redirects to the latest Temurin 21 build on GitHub.
        return f"https://api.adoptium.net/v3/binary/latest/21/ga/{_os()}/{_arch()}/jdk/hotspot/normal/eclipse?project=jdk"
    if lang == "c" and WIN and _arch() == "x64":
        return "https://download.savannah.gnu.org/releases/tinycc/tcc-0.9.27-win64-bin.zip"
    return None


MIRRORS = {"c": ["https://download-mirror.savannah.gnu.org/releases/tinycc/tcc-0.9.27-win64-bin.zip"]}


# ---------------------------------------------------------------- finding what's installed
def _version(cmd: list[str]) -> str:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        out = (p.stdout + p.stderr).strip().splitlines()
        return next((ln for ln in out if not ln.startswith("Picked up")), "")[:80]
    except (OSError, subprocess.SubprocessError):
        return ""


def find_java() -> dict | None:
    """{"javac", "java", "version", "source"} or None."""
    own = root() / "java"
    if own.exists():
        for javac in own.rglob(f"javac{EXE}"):
            java = javac.with_name(f"java{EXE}")
            if java.exists():
                return {"javac": str(javac), "java": str(java), "version": _version([str(javac), "-version"]), "source": "chalk"}
    home = os.environ.get("JAVA_HOME")
    cands = [Path(home) / "bin" / f"javac{EXE}"] if home else []
    w = shutil.which("javac")
    if w:
        cands.append(Path(w))
    for javac in cands:
        java = javac.with_name(f"java{EXE}")
        if javac.exists() and java.exists():
            return {"javac": str(javac), "java": str(java), "version": _version([str(javac), "-version"]), "source": "system"}
    return None


def find_c() -> dict | None:
    """{"cc", "kind": "gcc"|"clang"|"tcc", "version", "source"} or None."""
    own = root() / "c"
    if own.exists():
        for tcc in own.rglob(f"tcc{EXE}"):
            return {"cc": str(tcc), "kind": "tcc", "version": _version([str(tcc), "-v"]) or "TinyCC", "source": "chalk"}
    for name, kind in (("gcc", "gcc"), ("clang", "clang"), ("cc", "gcc"), ("tcc", "tcc")):
        w = shutil.which(name)
        if w:
            return {"cc": w, "kind": kind, "version": _version([w, "--version"] if kind != "tcc" else [w, "-v"]), "source": "system"}
    return None


_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, fn, ttl: float = 30):
    now = time.time()
    if key in _cache and now - _cache[key][0] < ttl:
        return _cache[key][1]
    v = fn()
    _cache[key] = (now, v)
    return v


def java() -> dict | None:
    return _cached("java", find_java)


def cc() -> dict | None:
    return _cached("c", find_c)


def forget():
    _cache.clear()


# ---------------------------------------------------------------- installing
progress: dict[str, dict] = {}   # lang -> {"phase", "done", "total", "error"}
_lock = threading.Lock()


def status() -> list[dict]:
    out = []
    for lang, info in LANGS.items():
        item: dict[str, Any] = {"id": lang, "name": info["name"]}
        p = progress.get(lang)
        if info["builtin"]:
            item["state"] = "builtin"
            item["detail"] = {"python": f"Python {platform.python_version()}, built in",
                              "javascript": "Runs inside Chalk",
                              "sql": f"SQLite {sqlite3.sqlite_version}, built in"}[lang]
        elif p and p.get("phase") not in (None, "done"):
            item.update(state="installing" if p["phase"] != "error" else "error", progress=p)
            if p["phase"] == "error":
                item["detail"] = p.get("error", "Download failed")
                item["can_download"] = bool(download_url(lang))
        else:
            found = java() if lang == "java" else cc()
            if found:
                item["state"] = "ready"
                item["source"] = found["source"]
                item["detail"] = (found.get("version") or info["name"]) + (" · downloaded by Chalk" if found["source"] == "chalk" else " · already on your PC")
            else:
                item["state"] = "missing"
                url = download_url(lang)
                item["can_download"] = bool(url)
                if info.get("size"):
                    item["size"] = info["size"]
                item["detail"] = (f"Download to run {info['name']} exercises" + (f" ({info['size']})" if info.get("size") else "") if url else
                                  "Install gcc or clang (e.g. with your package manager) and Chalk will find it")
        out.append(item)
    return out


def install(lang: str) -> None:
    """Download and unpack a toolchain in the background. Watch progress[lang]."""
    url = download_url(lang)
    if not url:
        raise ValueError(f"Chalk can't download {lang} on this computer")
    with _lock:
        if progress.get(lang, {}).get("phase") in ("downloading", "unpacking"):
            return
        progress[lang] = {"phase": "downloading", "done": 0, "total": 0}
    threading.Thread(target=_install, args=(lang, url), daemon=True).start()


def _install(lang: str, url: str) -> None:
    p = progress[lang]
    dest = root() / lang
    tmp = Path(tempfile.mkdtemp(prefix=f"chalk-{lang}-"))
    try:
        archive = None
        last_err: Exception | None = None
        for u in [url, *MIRRORS.get(lang, [])]:
            try:
                archive = _download(u, tmp, p)
                break
            except Exception as e:  # try the next mirror
                last_err = e
        if archive is None:
            raise last_err or RuntimeError("download failed")
        p["phase"] = "unpacking"
        staging = tmp / "unpacked"
        staging.mkdir()
        if zipfile.is_zipfile(archive):
            with zipfile.ZipFile(archive) as z:
                _safe_members(staging, z.namelist())
                z.extractall(staging)
        else:
            with tarfile.open(archive) as t:
                _safe_members(staging, t.getnames())
                t.extractall(staging, filter="data") if hasattr(tarfile, "data_filter") else t.extractall(staging)
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staging), str(dest))
        forget()
        found = java() if lang == "java" else cc()
        if not found or found["source"] != "chalk":
            raise RuntimeError("the download didn't contain what Chalk expected")
        if not WIN:  # tar keeps modes; zip doesn't
            for f in dest.rglob("*"):
                if f.is_file() and f.parent.name == "bin":
                    f.chmod(f.stat().st_mode | 0o111)
        p["phase"] = "done"
    except Exception as e:
        p.update(phase="error", error=_friendly(e))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _download(url: str, tmp: Path, p: dict) -> Path:
    req = urllib.request.Request(url, headers={"User-Agent": "Chalk"})
    with urllib.request.urlopen(req, timeout=60) as r:
        p["total"] = int(r.headers.get("Content-Length") or 0)
        p["done"] = 0
        name = Path(urllib.parse.urlparse(r.geturl()).path).name or "download"
        out = tmp / name
        with open(out, "wb") as fh:
            while chunk := r.read(1 << 16):
                fh.write(chunk)
                p["done"] += len(chunk)
    return out


def _safe_members(base: Path, names: list[str]) -> None:
    b = base.resolve()
    for n in names:
        if not (b / n).resolve().is_relative_to(b):
            raise RuntimeError("the download contained an unsafe path")


def _friendly(e: Exception) -> str:
    s = str(e)
    if "CERTIFICATE" in s.upper():
        return "Couldn't make a secure connection to the download site."
    if isinstance(e, urllib.error.HTTPError):
        return f"The download site answered {e.code}. Try again later."
    if isinstance(e, (urllib.error.URLError, TimeoutError, OSError)) and not isinstance(e, PermissionError):
        return "Couldn't reach the download site. Check your internet connection."
    return s[:200] or type(e).__name__


def remove(lang: str) -> None:
    if lang in ("java", "c"):
        shutil.rmtree(root() / lang, ignore_errors=True)
        progress.pop(lang, None)
        forget()


import urllib.error  # noqa: E402  (used in _friendly)
import urllib.parse  # noqa: E402
