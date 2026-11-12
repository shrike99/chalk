"""Local speech: faster-whisper (speech to text) and Kokoro (text to speech).

Both are optional. If they aren't installed, the endpoints report "unavailable"
and the web page falls back to typing and the browser's built-in voice.
Models load lazily on first use (the first call takes a while: it downloads them).
"""

from __future__ import annotations

import importlib
import importlib.util
import io
import os
import threading
import time

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3-turbo")
KOKORO_VOICE = os.getenv("KOKORO_VOICE", "af_heart")

_lock = threading.Lock()
_whisper = None
_whisper_device = None


def stt_available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def tts_available() -> bool:
    return importlib.util.find_spec("kokoro") is not None and importlib.util.find_spec("soundfile") is not None


def _prepare_cuda_on_windows() -> None:
    """Help faster-whisper find the CUDA DLLs on Windows.

    Importing torch first loads the cuBLAS/cuDNN DLLs it ships with; we also add
    the folders of the nvidia-* pip packages, if installed, to the DLL search path.
    """
    if os.name != "nt":
        return
    try:
        import torch  # noqa: F401
    except Exception:
        pass
    for pkg in ("nvidia.cublas", "nvidia.cudnn"):
        try:
            mod = importlib.import_module(pkg)
            for base in getattr(mod, "__path__", []):
                d = os.path.join(base, "bin")
                if os.path.isdir(d):
                    os.add_dll_directory(d)
                    os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
        except Exception:
            pass


def _load_whisper(device: str):
    from faster_whisper import WhisperModel

    if device == "cuda":
        return WhisperModel(WHISPER_MODEL, device="cuda", compute_type="float16")
    return WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")


def _get_whisper():
    global _whisper, _whisper_device
    if _whisper is None:
        _prepare_cuda_on_windows()
        try:
            _whisper, _whisper_device = _load_whisper("cuda"), "cuda"
        except Exception as e:
            print(f"[speech] Whisper on GPU failed ({e}); using CPU instead.")
            _whisper, _whisper_device = _load_whisper("cpu"), "cpu"
    return _whisper


def decode_audio(audio_bytes: bytes):
    """Browser recording (webm/ogg/wav…) -> 16 kHz mono float32 samples, the format Whisper wants.

    We decode it ourselves instead of letting faster-whisper do it: faster-whisper 1.2.x calls
    av.open(..., metadata_errors=...), which PyAV 19 (Sept 2026) removed, so every transcription
    failed with "open() got an unexpected keyword argument 'metadata_errors'".
    """
    import av
    import numpy as np

    chunks = []
    resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
    try:
        with av.open(io.BytesIO(audio_bytes), mode="r") as container:
            stream = container.streams.audio[0]
            try:
                for frame in container.decode(stream):
                    for f in resampler.resample(frame):
                        chunks.append(f.to_ndarray().reshape(-1))
            except (av.error.InvalidDataError, av.error.EOFError, EOFError):
                pass  # a clip cut mid-recording (live preview) ends abruptly: keep what decoded
            for f in resampler.resample(None):
                chunks.append(f.to_ndarray().reshape(-1))
    except av.error.InvalidDataError:
        if not chunks:
            raise
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def transcribe(audio_bytes: bytes, hint: str = "") -> dict:
    """Audio file bytes (webm/ogg/wav) -> text. Falls back to CPU if the GPU path fails."""
    global _whisper, _whisper_device
    t0 = time.perf_counter()
    samples = decode_audio(audio_bytes)
    if samples.size < 16000 * 0.2:  # under 0.2 s: nothing worth transcribing
        return {"text": "", "stt_ms": int((time.perf_counter() - t0) * 1000), "device": _whisper_device or "-"}
    with _lock:
        model = _get_whisper()

        def run(m):
            segments, _info = m.transcribe(
                samples,
                language="en",
                vad_filter=True,
                beam_size=1,
                initial_prompt=hint or None,
            )
            return "".join(s.text for s in segments).strip()

        try:
            text = run(model)
        except Exception as e:
            if _whisper_device != "cuda":
                raise
            # Usually a missing cuDNN/cuBLAS DLL: switch to CPU for the rest of the session.
            print(f"[speech] Whisper GPU inference failed ({e}); switching to CPU.")
            _whisper, _whisper_device = _load_whisper("cpu"), "cpu"
            text = run(_whisper)
    return {"text": text, "stt_ms": int((time.perf_counter() - t0) * 1000), "device": _whisper_device}


_kokoro_pipes: dict = {}


def _get_kokoro(lang: str = "a"):
    """One Kokoro pipeline per accent: "a" = American English, "b" = British English."""
    if lang not in _kokoro_pipes:
        from kokoro import KPipeline

        _kokoro_pipes[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M")
    return _kokoro_pipes[lang]


def speak(text: str, speed: float = 1.0, voice: str | None = None) -> bytes:
    """Text -> WAV bytes (24 kHz mono). Voice names start with their accent: af_/am_ American, bf_/bm_ British."""
    voice = (voice or KOKORO_VOICE).strip()
    lang = voice[0] if voice[:1] in ("a", "b") else "a"
    import numpy as np
    import soundfile as sf

    with _lock:
        pipe = _get_kokoro(lang)
        chunks = []
        for result in pipe(text, voice=voice, speed=speed):
            audio = getattr(result, "audio", None)
            if audio is None:
                audio = result[2]
            if hasattr(audio, "detach"):
                audio = audio.detach().cpu().numpy()
            chunks.append(np.asarray(audio, dtype=np.float32))
    audio = np.concatenate(chunks) if chunks else np.zeros(2400, dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, 24000, format="WAV")
    return buf.getvalue()
