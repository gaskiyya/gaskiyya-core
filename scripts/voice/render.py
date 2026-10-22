import asyncio
import json
import os
import shutil
import subprocess
import sys
import wave

import edge_tts
import numpy as np
from transformers import pipeline

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "apps", "console", "public", "audio", "agent")

VOICE = "en-NG-EzinneNeural"
RATE = "-6%"
CHECK_MODEL = "openai/whisper-medium.en"
SR = 24000

OPENINGS = {
    "demobank": "Hello, good day. I am calling from DemoBank. Your code is",
    "zb": "Hello, good day. I am calling from ZB Demo Bank. Your code is",
    "generic": "Hello, good day. I am calling from your bank. Your code is",
}
PAUSES = {"afterOpening": 380, "betweenDigits": 240}
DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
SOUNDS_LIKE = {"too": "two", "to": "two", "won": "one", "for": "four", "fore": "four", "ate": "eight", "oh": "zero", "o": "zero"}
HARVEST = ["".join(str((i + k) % 10) for k in (1, 3, 7)) + str(i) for i in range(10)]
TEST_CODES = ["0123", "4567", "8901", "2345", "6789", "6666", "3939", "1010", "7272", "5858", "9406", "3161"]

asr = pipeline("automatic-speech-recognition", CHECK_MODEL)


async def speak(text):
    """Returns (audio, [(word, start_sample, end_sample)])."""
    mp3, words = bytearray(), []
    async for chunk in edge_tts.Communicate(text, VOICE, rate=RATE, boundary="WordBoundary").stream():
        if chunk["type"] == "audio":
            mp3 += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            start = chunk["offset"] / 1e7
            words.append((chunk["text"].strip(".,").lower(), int(start * SR), int((start + chunk["duration"] / 1e7) * SR)))
    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", str(SR), "pipe:1"], input=bytes(mp3), capture_output=True, check=True).stdout
    return np.frombuffer(pcm, "<i2").astype(np.float32) / 32768, words


def heard(x):
    n = int(len(x) * 16000 / SR)
    text = asr({"raw": np.interp(np.arange(n) * SR / 16000, np.arange(len(x)), x).astype(np.float32), "sampling_rate": 16000})["text"]
    out = []
    for w in "".join(c if c.isalnum() else " " for c in text.lower()).split():
        out += [DIGITS[int(c)] for c in w] if w.isdigit() else [SOUNDS_LIKE.get(w, w)]
    return text.strip(), out


def rms(x):
    return float(np.sqrt(np.mean(x * x))) if len(x) else 0.0


def tighten(x, quiet=0.004, pre=0.03, post=0.08):
    w = SR // 100
    loud = [i for i in range(0, len(x), w) if rms(x[i : i + w]) >= quiet]
    if not loud:
        return x
    return x[max(0, loud[0] - int(SR * pre)) : min(len(x), loud[-1] + w + int(SR * post))]


def fade(x, ms=6):
    n = min(len(x) // 2, int(SR * ms / 1000))
    x = x.copy()
    ramp = np.linspace(0, 1, n, dtype=np.float32)
    x[:n] *= ramp
    x[len(x) - n :] *= ramp[::-1]
    return x


def silence(ms):
    return np.zeros(int(SR * ms / 1000), dtype=np.float32)


def save(path, x):
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes((np.clip(x, -1, 1) * 32767).round().astype("<i2").tobytes())


def spoken(code):
    return ", ".join(DIGITS[int(c)] for c in code)


def gap_cut(a, words, i):
    """The midpoint of the silence between word i-1 and word i, in samples."""
    return (words[i - 1][2] + words[i][1]) // 2


async def main():
    failures, clips, digit_takes = [], {}, {}
    for org, opening in OPENINGS.items():
        text = f"{opening} {spoken('4826')}."
        a, words = await speak(text)
        t, got = heard(a)
        if [w for w in got if w in DIGITS] != [DIGITS[int(c)] for c in "4826"] or len(words) < 5:
            failures.append(f"opening-{org}: heard \"{t}\"")
            continue
        clips[f"opening-{org}"] = {"text": opening, "x": a[: gap_cut(a, words, len(words) - 4)]}
        print(f"ok   opening-{org:12} \"{t}\"")
    for code in HARVEST:
        a, words = await speak(f"{OPENINGS['generic']} {spoken(code)}.")
        t, got = heard(a)
        if [w for w in got if w in DIGITS] != [DIGITS[int(c)] for c in code] or [w for w, _, _ in words[-4:]] != [DIGITS[int(c)] for c in code]:
            failures.append(f"harvest {code}: heard \"{t}\"")
            continue
        n = len(words)
        for k in range(1, 4):
            i = n - 4 + k
            start = gap_cut(a, words, i)
            end = gap_cut(a, words, i + 1) if k < 3 else len(a)
            digit_takes.setdefault(f"digit-{code[k]}-{'last' if k == 3 else 'mid'}", a[start:end])
        print(f"ok   harvest {code}          \"{t}\"")

    for d in range(10):
        for pos in ("mid", "last"):
            key = f"digit-{d}-{pos}"
            if key not in digit_takes:
                failures.append(f"{key}: not harvested")
                continue
            clips[key] = {"text": DIGITS[d].capitalize() + ("." if pos == "last" else ","), "x": digit_takes[key]}

    for c in clips.values():
        c["x"] = tighten(c["x"])
    peak = max(float(np.max(np.abs(c["x"]))) for c in clips.values())
    gain = 10 ** (-1.5 / 20) / peak
    for c in clips.values():
        c["x"] = fade(c["x"] * gain)

    for code in [] if failures else TEST_CODES:
        parts = [clips["opening-generic"]["x"], silence(PAUSES["afterOpening"])]
        for i, ch in enumerate(code):
            parts += [clips[f"digit-{ch}-{'last' if i == len(code) - 1 else 'mid'}"]["x"], silence(PAUSES["betweenDigits"])]
        t, got = heard(np.concatenate(parts))
        digits = [w for w in got if w in DIGITS]
        ok = digits == [DIGITS[int(c)] for c in code]
        print(f"{'ok  ' if ok else 'FAIL'} call {code}               \"{t}\"")
        if not ok:
            failures.append(f"call {code}: heard \"{t}\"")

    if failures:
        print(f"\n{len(failures)} check(s) failed; nothing written:\n" + "\n".join(failures), file=sys.stderr)
        sys.exit(1)

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for k, c in clips.items():
        save(os.path.join(OUT, f"{k}.wav"), c["x"])
    manifest = {
        "_note": "Generated by scripts/voice/render.py (pnpm render:voice). Do not edit by hand.",
        "voice": VOICE,
        "rate": RATE,
        "sampleRate": SR,
        "pauses": PAUSES,
        "clips": {k: {"text": c["text"], "ms": round(len(c["x"]) / SR * 1000)} for k, c in clips.items()},
    }
    with open(os.path.join(OUT, "voice.json"), "w") as f:
        f.write(json.dumps(manifest, indent=2) + "\n")
    print(f"\nAll checks passed. Wrote {len(clips)} clips and voice.json to {OUT}")


asyncio.run(main())
