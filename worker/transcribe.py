"""Speech to text for the cloud worker (faster-whisper, MIT). Prints JSON only.

usage: transcribe.py <16 kHz mono wav> <max seconds>
"""
import json
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel

path, max_sec = sys.argv[1], float(sys.argv[2])
w = wave.open(path, "rb")
sr = w.getframerate()
frames = min(w.getnframes(), int(max_sec * sr))
audio = np.frombuffer(w.readframes(frames), dtype=np.int16).astype(np.float32) / 32768.0
# "small" understands Hindi, Urdu and Hinglish well enough and runs on a CPU runner.
model = WhisperModel("small", device="cpu", compute_type="int8")
segs, info = model.transcribe(audio, beam_size=1, vad_filter=True, condition_on_previous_text=False)
out = [{"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()} for s in segs]
print(json.dumps({"language": info.language, "transcript": out, "listenedSec": len(audio) / sr}))
