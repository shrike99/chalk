"""Claude plan usage (the same numbers Claude Code's /usage shows).

Reads the OAuth token Claude Code saved when the user signed in and asks
Anthropic's usage endpoint for each limit window. The endpoint is the one
Claude Code itself uses; it isn't a documented public API, so everything here
fails soft: on any problem we return None and the UI falls back to the coarse
status that arrives with each reply.
"""
from __future__ import annotations

import json
import os
import time
import urllib.request
from datetime import datetime
from pathlib import Path

URL = "https://api.anthropic.com/api/oauth/usage"
TTL = 60  # seconds between real requests

# Window key -> (label, short label). Order is display order.
WINDOWS = {
    "five_hour": ("Current session", "Session"),
    "seven_day": ("This week, all models", "Week"),
    "seven_day_opus": ("This week, Opus", "Opus"),
    "seven_day_sonnet": ("This week, Sonnet", "Sonnet"),
}

_cache: dict = {"at": 0.0, "data": None, "error": None}


def _config_dir() -> Path:
    env = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(env) if env else Path.home() / ".claude"


def _token() -> str | None:
    env = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN")
    if env:
        return env
    try:
        creds = json.loads((_config_dir() / ".credentials.json").read_text("utf-8"))
    except (OSError, ValueError):
        return None
    oauth = creds.get("claudeAiOauth") or {}
    tok = oauth.get("accessToken")
    exp = oauth.get("expiresAt")  # ms since epoch
    if not tok:
        return None
    if isinstance(exp, (int, float)) and exp / 1000 < time.time() + 30:
        return None  # expired; Claude Code refreshes it on the next turn
    return tok


def _epoch(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def parse(raw: dict) -> dict:
    windows = []
    for key, (label, short) in WINDOWS.items():
        w = raw.get(key)
        if not isinstance(w, dict) or w.get("utilization") is None:
            continue
        windows.append({
            "key": key, "label": label, "short": short,
            "pct": max(0.0, min(100.0, float(w["utilization"]))),
            "resets_at": _epoch(w.get("resets_at")),
        })
    extra = raw.get("extra_usage") if isinstance(raw.get("extra_usage"), dict) else None
    return {"windows": windows, "extra_enabled": bool(extra and extra.get("is_enabled")),
            "fetched_at": time.time()}


def _fetch(token: str) -> dict:
    req = urllib.request.Request(URL, headers={
        "Authorization": f"Bearer {token}",
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
        "User-Agent": "chalk-desktop",
    })
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode("utf-8"))


def get(force: bool = False) -> dict | None:
    """Usage windows, cached for TTL seconds. None when unavailable."""
    mock = os.environ.get("CHALK_USAGE_MOCK")
    if mock:
        return parse(json.loads(mock))
    now = time.time()
    if now - _cache["at"] < (10 if force else TTL):
        return _cache["data"]
    _cache["at"] = now
    token = _token()
    if not token:
        _cache["error"] = "no-token"
        return _cache["data"]
    try:
        _cache["data"] = parse(_fetch(token))
        _cache["error"] = None
    except Exception as e:  # network, 401, format change… keep the last good value
        _cache["error"] = type(e).__name__
    return _cache["data"]
