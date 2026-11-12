"""Downloads the voice models once, so the first message doesn't wait (used by install-voice.bat)."""
import os

import speech

print("Checking the graphics card…")
try:
    import torch
    print("  CUDA available:", torch.cuda.is_available(), "-", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "using CPU")
except Exception as e:
    print("  PyTorch not available:", e)

if speech.stt_available():
    print(f"Downloading Whisper ({speech.WHISPER_MODEL}, about 1.6 GB)…")
    from faster_whisper import WhisperModel
    WhisperModel(speech.WHISPER_MODEL, device="cpu", compute_type="int8")
    print("  done")

if speech.tts_available():
    print("Downloading Kokoro voices…")
    for voice in ("af_heart", "bf_emma"):
        wav = speech.speak("Hello! This is how I sound.", 1.0, voice)
        print(f"  {voice}: ok ({len(wav) // 1024} KB test clip)")
    out = os.path.join(os.environ.get("CHALK_DATA") or os.path.dirname(__file__), "voice-test.wav")
    with open(out, "wb") as f:
        f.write(speech.speak("Hi! I'll talk you through things step by step.", 1.0, "bf_emma"))
    print(f"  saved a sample to {out}: double-click it to hear the voice")
print("All set.")
