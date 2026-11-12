"""Which Kokoro voices (and speech models) are on this PC, how much space they use, and
downloading / deleting individual voices.

Kokoro and Whisper download their files into the Hugging Face cache
(usually C:\\Users\\<you>\\.cache\\huggingface\\hub). Each Kokoro voice is one small file
(voices/<name>.pt, about half a megabyte); the Kokoro model itself is about 330 MB.
"""

from __future__ import annotations

import os
from typing import Any

KOKORO_REPO = "hexgrad/Kokoro-82M"

# Kokoro v1.0 English voices: (id, name, accent, gender, note)
CATALOGUE: list[tuple[str, str, str, str, str]] = [
    ("af_heart", "Heart", "American", "female", "warmest, highest rated"),
    ("af_bella", "Bella", "American", "female", "expressive"),
    ("af_nicole", "Nicole", "American", "female", "soft, close-up"),
    ("af_aoede", "Aoede", "American", "female", ""),
    ("af_kore", "Kore", "American", "female", ""),
    ("af_sarah", "Sarah", "American", "female", ""),
    ("af_nova", "Nova", "American", "female", ""),
    ("af_sky", "Sky", "American", "female", ""),
    ("af_alloy", "Alloy", "American", "female", ""),
    ("af_jessica", "Jessica", "American", "female", ""),
    ("af_river", "River", "American", "female", ""),
    ("am_michael", "Michael", "American", "male", "clear"),
    ("am_fenrir", "Fenrir", "American", "male", "deeper"),
    ("am_puck", "Puck", "American", "male", "lively"),
    ("am_echo", "Echo", "American", "male", ""),
    ("am_eric", "Eric", "American", "male", ""),
    ("am_liam", "Liam", "American", "male", ""),
    ("am_onyx", "Onyx", "American", "male", ""),
    ("am_adam", "Adam", "American", "male", ""),
    ("am_santa", "Santa", "American", "male", "festive"),
    ("bf_emma", "Emma", "British", "female", "warm, clear"),
    ("bf_isabella", "Isabella", "British", "female", ""),
    ("bf_alice", "Alice", "British", "female", ""),
    ("bf_lily", "Lily", "British", "female", ""),
    ("bm_george", "George", "British", "male", "calm"),
    ("bm_fable", "Fable", "British", "male", "storyteller"),
    ("bm_lewis", "Lewis", "British", "male", ""),
    ("bm_daniel", "Daniel", "British", "male", ""),
]
IDS = {c[0] for c in CATALOGUE}


def _cache():
    from huggingface_hub import scan_cache_dir

    return scan_cache_dir()


def _repo_files(info, repo_id: str) -> list:
    for repo in info.repos:
        if repo.repo_id == repo_id:
            files = []
            for rev in repo.revisions:
                files.extend(rev.files)
            return files
    return []


def inventory() -> dict[str, Any]:
    """What's downloaded, with sizes in bytes."""
    try:
        info = _cache()
    except Exception as e:  # huggingface_hub missing or no cache yet
        return {"available": False, "error": str(e), "voices": [], "models": []}

    files = _repo_files(info, KOKORO_REPO)
    voice_size = {os.path.splitext(f.file_name)[0]: f.size_on_disk for f in files if f.file_path.parent.name == "voices"}
    model_files = [f for f in files if f.file_path.parent.name != "voices"]
    models = []
    if model_files:
        models.append({"name": "Kokoro model", "repo": KOKORO_REPO, "bytes": sum(f.size_on_disk for f in model_files)})
    for repo in info.repos:
        if "whisper" in repo.repo_id.lower():
            models.append({"name": f"Whisper ({repo.repo_id.split('/')[-1]})", "repo": repo.repo_id, "bytes": repo.size_on_disk})
    voices = [{"id": vid, "name": name, "accent": accent, "gender": gender, "note": note,
               "installed": vid in voice_size, "bytes": voice_size.get(vid, 0)}
              for vid, name, accent, gender, note in CATALOGUE]
    # voices in the cache that aren't in our list (other languages etc.)
    for vid, size in voice_size.items():
        if vid not in IDS:
            voices.append({"id": vid, "name": vid, "accent": "other", "gender": "", "note": "", "installed": True, "bytes": size})
    return {"available": True, "cache_dir": str(info.repos and next(iter(info.repos)).repo_path.parent or ""), "voices": voices, "models": models}


def download(voice: str) -> None:
    if voice not in IDS:
        raise ValueError(f"Unknown voice {voice}")
    from huggingface_hub import hf_hub_download

    hf_hub_download(KOKORO_REPO, f"voices/{voice}.pt")


def delete(voice: str) -> None:
    """Remove one voice file from the cache (it's downloaded again if you use it later)."""
    info = _cache()
    for f in _repo_files(info, KOKORO_REPO):
        if f.file_path.parent.name == "voices" and os.path.splitext(f.file_name)[0] == voice:
            for p in {f.file_path, f.blob_path}:
                try:
                    os.remove(p)
                except FileNotFoundError:
                    pass
    # drop any loaded copy so a deleted voice isn't still used from memory
    try:
        import speech

        for pipe in speech._kokoro_pipes.values():
            getattr(pipe, "voices", {}).pop(voice, None)
    except Exception:
        pass


# ---------- mock data, for TUTOR_MOCK=1 ----------
def mock_inventory() -> dict[str, Any]:
    have = {"af_heart": 523_436, "bf_emma": 523_436, "bm_george": 523_436}
    return {
        "available": True, "cache_dir": "(mock)",
        "voices": [{"id": v, "name": n, "accent": a, "gender": g, "note": note, "installed": v in have, "bytes": have.get(v, 0)}
                   for v, n, a, g, note in CATALOGUE],
        "models": [{"name": "Kokoro model", "repo": KOKORO_REPO, "bytes": 327_212_226},
                   {"name": "Whisper (faster-whisper-large-v3-turbo)", "repo": "mobiuscloud/faster-whisper-large-v3-turbo", "bytes": 1_620_000_000}],
    }
