#!/usr/bin/env python3
"""Generate the original "Buckle" starter fighter's sound cues.

Buckle is a crash-test dummy, so every cue is synthesized from servo whines,
pneumatic hisses, metal clanks, and a buzzy formant-filtered "robot voice".
Nothing is sampled, so the sounds carry no third-party rights and are
published as CC0-1.0, like the sprites.

    python3 scripts/starter_fighter/generate_audio.py
    npm run fighter:build -- buckle

Needs only the Python standard library and ffmpeg (with libvorbis). Output is
seeded, so a re-run reproduces the same waveforms.
"""

from __future__ import annotations

import math
import random
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

RATE = 44_100
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "fighters" / "buckle" / "audio"

Signal = list[float]


def silence(seconds: float) -> Signal:
    return [0.0] * int(seconds * RATE)


def envelope(samples: Signal, attack: float, release: float, curve: float = 1.0) -> Signal:
    """Linear attack, then a decay to zero over the rest; `curve` > 1 decays faster."""
    count = len(samples)
    attack_n = max(1, int(attack * RATE))
    release_n = max(1, int(release * RATE))
    out = []
    for index, value in enumerate(samples):
        gain = min(1.0, index / attack_n)
        remaining = count - index
        if remaining < release_n:
            gain *= (remaining / release_n) ** curve
        out.append(value * gain)
    return out


def decay(samples: Signal, seconds: float) -> Signal:
    """Exponential decay with the given time constant."""
    return [value * math.exp(-index / (seconds * RATE)) for index, value in enumerate(samples)]


def mix(*signals: tuple[float, Signal]) -> Signal:
    length = max(len(signal) for _, signal in signals)
    out = [0.0] * length
    for gain, signal in signals:
        for index, value in enumerate(signal):
            out[index] += gain * value
    return out


def concat(*signals: Signal) -> Signal:
    out: Signal = []
    for signal in signals:
        out.extend(signal)
    return out


def tone(seconds: float, start_hz: float, end_hz: float | None = None, shape: str = "sine",
         vibrato_hz: float = 0.0, vibrato_depth: float = 0.0) -> Signal:
    """An oscillator gliding exponentially from start_hz to end_hz."""
    end_hz = start_hz if end_hz is None else end_hz
    count = int(seconds * RATE)
    phase = 0.0
    out = []
    for index in range(count):
        progress = index / max(1, count - 1)
        frequency = start_hz * (end_hz / start_hz) ** progress
        if vibrato_hz:
            frequency *= 1 + vibrato_depth * math.sin(2 * math.pi * vibrato_hz * index / RATE)
        phase = (phase + frequency / RATE) % 1.0
        if shape == "sine":
            out.append(math.sin(2 * math.pi * phase))
        elif shape == "square":
            # Two odd harmonics: square-ish but not harsh.
            out.append(math.sin(2 * math.pi * phase) + math.sin(6 * math.pi * phase) / 3)
        else:  # "saw": the buzzy glottal source for the robot voice
            out.append(2 * phase - 1)
    return out


def noise(seconds: float, rng: random.Random) -> Signal:
    return [rng.uniform(-1, 1) for _ in range(int(seconds * RATE))]


def biquad_bandpass(samples: Signal, center_hz: float | list[float], q: float) -> Signal:
    """RBJ constant-peak bandpass; center_hz may vary per sample for sweeps."""
    x1 = x2 = y1 = y2 = 0.0
    out = []
    for index, value in enumerate(samples):
        center = center_hz[index] if isinstance(center_hz, list) else center_hz
        omega = 2 * math.pi * min(center, RATE * 0.45) / RATE
        alpha = math.sin(omega) / (2 * q)
        a0 = 1 + alpha
        b0, b2 = alpha / a0, -alpha / a0
        a1, a2 = -2 * math.cos(omega) / a0, (1 - alpha) / a0
        y = b0 * value + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, value
        y2, y1 = y1, y
        out.append(y)
    return out


def sweep(seconds: float, start_hz: float, end_hz: float) -> list[float]:
    count = int(seconds * RATE)
    return [start_hz * (end_hz / start_hz) ** (index / max(1, count - 1)) for index in range(count)]


def lowpass(samples: Signal, cutoff_hz: float) -> Signal:
    coefficient = 1 - math.exp(-2 * math.pi * cutoff_hz / RATE)
    state = 0.0
    out = []
    for value in samples:
        state += coefficient * (value - state)
        out.append(state)
    return out


def clank(seconds: float, base_hz: float) -> Signal:
    """Struck metal: inharmonic partials with fast, uneven decays."""
    partials = [(1.0, 1.0, 0.09), (2.76, 0.6, 0.05), (5.40, 0.35, 0.03), (8.93, 0.2, 0.02)]
    return mix(*((gain, decay(tone(seconds, base_hz * ratio), time)) for ratio, gain, time in partials))


VOWELS = {
    # (F1, F2, F3) in Hz
    "uh": (640, 1190, 2390),
    "ah": (730, 1090, 2440),
    "oo": (300, 870, 2240),
    "ee": (270, 2290, 3010),
    "ul": (450, 900, 2500),
}


def robot_voice(seconds: float, start_hz: float, end_hz: float, vowel: str | tuple[str, str],
                vibrato_hz: float = 0.0) -> Signal:
    """A sawtooth 'glottis' through three formant resonators; a pair of vowels glides between them."""
    source = tone(seconds, start_hz, end_hz, "saw", vibrato_hz, 0.03 if vibrato_hz else 0.0)
    first, last = (vowel, vowel) if isinstance(vowel, str) else vowel
    count = len(source)
    out = [0.0] * count
    for formant in range(3):
        begin, end = VOWELS[first][formant], VOWELS[last][formant]
        centers = [begin + (end - begin) * index / max(1, count - 1) for index in range(count)]
        band = biquad_bandpass(source, centers, q=6 + formant * 3)
        weight = (1.0, 0.6, 0.3)[formant]
        for index, value in enumerate(band):
            out[index] += weight * value
    return out


def normalize(samples: Signal, rms_db: float = -19.0, peak: float = 0.89) -> Signal:
    """Level every cue to the same loudness (RMS), so beeps do not drown out
    noisy cues, without letting any peak clip."""
    # Short fades so nothing clicks at the edges.
    faded = envelope(samples, 0.002, 0.01)
    rms = math.sqrt(sum(value * value for value in faded) / len(faded)) or 1.0
    loudest = max(abs(value) for value in faded) or 1.0
    gain = min(10 ** (rms_db / 20) / rms, peak / loudest)
    return [value * gain for value in faded]


def write_ogg(name: str, samples: Signal, scratch: Path) -> None:
    wav = scratch / f"{name}.wav"
    data = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, value)) * 32767)) for value in normalize(samples))
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(data), b"WAVE", b"fmt ", 16, 1, 1,
                         RATE, RATE * 2, 2, 16, b"data", len(data))
    wav.write_bytes(header + data)
    target = OUT / f"{name}.ogg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "libvorbis", "-q:a", "4",
                    "-map_metadata", "-1", "-fflags", "+bitexact", str(target)], check=True)


def build(rng: random.Random) -> dict[str, Signal]:
    sounds: dict[str, Signal] = {}

    # attack: a whoosh of air past a stiff limb, with a servo chirp.
    for index, (pitch, length) in enumerate([(900, 0.16), (1100, 0.15), (780, 0.18)], start=1):
        whoosh = envelope(biquad_bandpass(noise(length, rng), sweep(length, 700, 2600), 1.2), 0.03, length - 0.03, 2)
        servo = envelope(tone(length * 0.6, pitch, pitch * 0.7, "square"), 0.004, length * 0.5, 2)
        sounds[f"attack-{index}"] = mix((1.0, whoosh), (0.22, servo))

    # smash: servos wind up, then a heavy hydraulic swing.
    for index, pitch in enumerate([220, 260], start=1):
        windup = envelope(tone(0.18, pitch, pitch * 2.2, "square", 30, 0.02), 0.01, 0.03)
        swing_noise = biquad_bandpass(noise(0.3, rng), sweep(0.3, 400, 1800), 1.0)
        swing = envelope(mix((1.0, swing_noise), (0.4, lowpass(noise(0.3, rng), 180))), 0.02, 0.25, 2)
        sounds[f"smash-{index}"] = concat(mix((0.35, windup)), mix((1.0, swing), (0.5, decay(tone(0.3, 70, 45), 0.08))))

    # special: rocket ignition.
    ignition = mix(
        (1.0, envelope(lowpass(noise(0.55, rng), 900), 0.02, 0.35)),
        (0.6, envelope(biquad_bandpass(noise(0.55, rng), sweep(0.55, 3000, 900), 2.0), 0.005, 0.4, 2)),
        (0.5, decay(tone(0.55, 90, 55), 0.15)),
    )
    sounds["special"] = concat(decay(clank(0.06, 1400), 0.02), ignition)

    # jump: pneumatic kick and a springy chirp.
    for index, pitch in enumerate([360, 420], start=1):
        hiss = envelope(biquad_bandpass(noise(0.12, rng), 5000, 1.5), 0.002, 0.11, 2)
        chirp = envelope(tone(0.16, pitch, pitch * 2.4), 0.003, 0.13, 2)
        sounds[f"jump-{index}"] = mix((0.5, hiss), (0.6, chirp))

    # hurt: a dented clank and a short robot "uh!".
    for index, (pitch, vowel) in enumerate([(150, "uh"), (170, "ah"), (135, ("ah", "uh"))], start=1):
        voice = envelope(robot_voice(0.22, pitch * 1.25, pitch * 0.85, vowel), 0.01, 0.15, 1.5)
        sounds[f"hurt-{index}"] = mix((0.55, clank(0.25, 520 + index * 90)), (1.0, voice))

    # ko: a falling, wavering wail that sputters out over sparks.
    wail = envelope(robot_voice(1.0, 340, 70, ("ah", "oo"), vibrato_hz=7), 0.02, 0.6, 1.2)
    sparks = [value if rng.random() < 0.04 else 0.0 for value in noise(1.0, rng)]
    sounds["ko"] = mix((1.0, wail), (0.5, decay(biquad_bandpass(sparks, 4000, 1.0), 0.4)))

    # taunt: three robot beeps, "dee-doo-dee".
    beeps = [envelope(tone(0.09, hz, None, "square"), 0.004, 0.03) for hz in (880, 660, 990)]
    sounds["taunt"] = concat(beeps[0], silence(0.03), beeps[1], silence(0.03), beeps[2])

    # victory: a square-wave fanfare and a celebratory airbag pop.
    notes = [(523, 0.11), (659, 0.11), (784, 0.11), (1047, 0.42)]
    fanfare = concat(*(envelope(tone(length, hz, None, "square", 6 if length > 0.2 else 0, 0.01), 0.005, 0.05)
                       for hz, length in notes))
    pop = envelope(lowpass(noise(0.12, rng), 2500), 0.001, 0.11, 3)
    sounds["victory"] = mix((0.7, fanfare), (0.6, concat(silence(0.33), pop)))

    # announce: a two-syllable robot call, "buh-kul", pitched down like a dummy's voice box.
    bump = decay(lowpass(noise(0.02, rng), 600), 0.004)
    first = envelope(robot_voice(0.17, 140, 128, "uh"), 0.01, 0.04)
    stop = envelope(biquad_bandpass(noise(0.035, rng), 2200, 2.0), 0.002, 0.03)
    second = envelope(robot_voice(0.3, 122, 96, ("uh", "ul")), 0.015, 0.18, 1.5)
    sounds["announce"] = concat(bump, first, silence(0.03), mix((0.5, stop)), second)
    return sounds


def main() -> int:
    if shutil.which("ffmpeg") is None:
        print("ffmpeg is required (run npm run content:doctor)", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    sounds = build(random.Random(0xB0C1E))
    with tempfile.TemporaryDirectory() as scratch:
        for name, samples in sounds.items():
            write_ogg(name, samples, Path(scratch))
    total = sum((OUT / f"{name}.ogg").stat().st_size for name in sounds)
    print(f"Wrote {len(sounds)} cues to {OUT.relative_to(ROOT)} ({total // 1024} KiB).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
