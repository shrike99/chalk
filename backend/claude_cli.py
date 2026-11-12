"""Account helpers: ask Claude Code who you're signed in as, and sign in or out.

Uses the copy of Claude Code that ships inside the claude-agent-sdk package
(falls back to a `claude` on your PATH), so it's the same login the tutor uses.
"""

from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import threading

os.environ.pop("ANTHROPIC_API_KEY", None)

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def find_cli() -> str | None:
    try:
        import claude_agent_sdk

        base = os.path.join(os.path.dirname(claude_agent_sdk.__file__), "_bundled")
        for name in ("claude.exe", "claude"):
            p = os.path.join(base, name)
            if os.path.isfile(p):
                return p
        found = glob.glob(os.path.join(base, "claude*"))
        if found:
            return found[0]
    except Exception:
        pass
    return shutil.which("claude")


def _run(*args: str, timeout: float = 20) -> subprocess.CompletedProcess:
    cli = find_cli()
    if not cli:
        raise RuntimeError("Claude Code was not found. Reinstall the backend requirements.")
    return subprocess.run(
        [cli, *args], capture_output=True, text=True, timeout=timeout,
        stdin=subprocess.DEVNULL, creationflags=_NO_WINDOW,
    )


def auth_status() -> dict:
    if os.getenv("TUTOR_MOCK") == "1":
        return {"loggedIn": True, "authMethod": "claude.ai", "email": "you@example.com",
                "subscriptionType": "pro", "mock": True}
    try:
        out = _run("auth", "status", "--json")
        data = json.loads(out.stdout or "{}")
    except Exception as e:
        return {"loggedIn": False, "error": str(e)}
    data["usingApiKey"] = data.get("authMethod") in ("api_key", "apiKey", "console")
    return data


def logout() -> dict:
    if os.getenv("TUTOR_MOCK") != "1":
        _run("auth", "logout")
    return auth_status()


class LoginFlow:
    """Runs `claude auth login --claudeai` in the background.

    Claude Code opens your browser to sign in. If the browser can't send the code back
    automatically, the sign-in page shows a code to paste: submit_code() passes it on.
    """

    def __init__(self) -> None:
        self.proc: subprocess.Popen | None = None
        self.url: str | None = None
        self.output: list[str] = []
        self._lock = threading.Lock()

    def start(self) -> dict:
        with self._lock:
            if self.proc and self.proc.poll() is None:
                return self.state()
            self.url, self.output = None, []
            if os.getenv("TUTOR_MOCK") == "1":
                return {"running": False, "url": None, "note": "mock mode"}
            cli = find_cli()
            if not cli:
                raise RuntimeError("Claude Code was not found.")
            self.proc = subprocess.Popen(
                [cli, "auth", "login", "--claudeai"],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, creationflags=_NO_WINDOW,
            )
            threading.Thread(target=self._read, daemon=True).start()
        # Give it a moment to print the sign-in link.
        for _ in range(30):
            if self.url or (self.proc and self.proc.poll() is not None):
                break
            threading.Event().wait(0.1)
        return self.state()

    def _read(self) -> None:
        assert self.proc and self.proc.stdout
        for line in self.proc.stdout:
            self.output.append(line.rstrip())
            m = re.search(r"https://\S+", line)
            if m and not self.url:
                self.url = m.group(0)

    def submit_code(self, code: str) -> dict:
        if self.proc and self.proc.poll() is None and self.proc.stdin:
            self.proc.stdin.write(code.strip() + "\n")
            self.proc.stdin.flush()
            try:
                self.proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                pass
        return self.state()

    def cancel(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.kill()

    def state(self) -> dict:
        running = bool(self.proc and self.proc.poll() is None)
        return {"running": running, "url": self.url, "output": self.output[-5:]}


login_flow = LoginFlow()
