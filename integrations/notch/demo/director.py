#!/usr/bin/env python3
"""
Notch autonomous demo director.

One command → records the screen, drives Notch through its own remote API
(no voice input needed, so the mic can't break it), logs exact cut points,
generates clean ElevenLabs narration, and edits a finished 1080p video with
ffmpeg. Fire it and walk away.

Usage:  python3 director.py [beats.json]
Output: ~/NotchOutbox/notch-demo.mp4
"""
import json, subprocess, sys, time, signal, urllib.request
from pathlib import Path

HOME = Path.home()
DEMO = Path(__file__).resolve().parent
RAW = DEMO / "raw"; NARR = DEMO / "narration"; CLIPS = DEMO / "clips"; OUT = DEMO / "out"
for d in (RAW, NARR, CLIPS, OUT):
    d.mkdir(parents=True, exist_ok=True)

# --- config from ~/.notch ---
def cfg(key, default=None):
    p = HOME / ".notch/config"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == key:
                return v.strip().strip('"\'')
    return default

TOKEN = (HOME / ".notch/remote-token").read_text().strip()
BASE = f"http://127.0.0.1:8737/t/{TOKEN}/"
EL_KEY = cfg("ELEVENLABS_API_KEY")
EL_VOICE = cfg("ELEVENLABS_VOICE_ID") or cfg("NOTCH_VOICE_ID") or "JBFqnCBsd6RMkjVDRZzb"

# Retina screen geometry (points -> 2x pixels). Panel is top-center.
SCREEN_DEV = "3"          # avfoundation "Capture screen 0"
FPS = 30
# Punch-in crop (pixels), 16:9, centered on the top notch panel.
PUNCH = "crop=1636:920:892:0,scale=1920:1080"
WIDE = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black"

def http_get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=5) as r:
            return json.loads(r.read())
    except Exception:
        return None

def http_post(path, obj):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status == 200
    except Exception:
        return False

def notch_state():
    s = http_get("state")
    return (s or {}).get("state", "")

def send_command(text):
    return http_post("command", {"text": text})

# --- ElevenLabs narration ---
def _say_fallback(text, path):
    aiff = path.with_suffix(".aiff")
    subprocess.run(["say", "-o", str(aiff), text], check=False)
    subprocess.run(["ffmpeg", "-y", "-i", str(aiff), str(path)], capture_output=True)

def synth(text, path):
    # curl, not urllib: this env's urllib 401s on the ElevenLabs header
    # (leftover proxy config); curl sends it cleanly. say() is the floor.
    if EL_KEY:
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{EL_VOICE}?output_format=mp3_44100_128"
        body = json.dumps({"text": text, "model_id": "eleven_turbo_v2_5",
                           "voice_settings": {"stability": 0.4, "similarity_boost": 0.75}})
        r = subprocess.run(["curl", "-s", "--noproxy", "*", "-o", str(path), "-w", "%{http_code}",
                            "-X", "POST", url,
                            "-H", f"xi-api-key: {EL_KEY}",
                            "-H", "Content-Type: application/json",
                            "-d", body], capture_output=True, text=True)
        if r.stdout.strip() == "200" and path.exists() and path.stat().st_size > 1000:
            return
        print(f"   (ElevenLabs {r.stdout.strip()} — using system voice)")
    _say_fallback(text, path)

def audio_dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "default=nk=1:nw=1", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 3.0

# --- title/outro cards (drawn with ffmpeg) ---
def make_card(text, subtext, path, seconds=3.0):
    esc = lambda s: s.replace("'", "’").replace(":", "\\:").replace(",", "\\,")
    vf = (f"drawtext=text='{esc(text)}':fontcolor=white:fontsize=96:"
          f"fontfile=/System/Library/Fonts/SFNS.ttf:x=(w-tw)/2:y=(h-th)/2-60:"
          f"alpha='min(1,(t)/0.6)'")
    if subtext:
        vf += (f",drawtext=text='{esc(subtext)}':fontcolor=0x9BB4FF:fontsize=42:"
               f"fontfile=/System/Library/Fonts/SFNS.ttf:x=(w-tw)/2:y=(h-th)/2+60:"
               f"alpha='min(1,(t)/0.6)'")
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=black:s=1920x1080:d={seconds}:r={FPS}",
                    "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
                   capture_output=True)

def main():
    beats_file = Path(sys.argv[1]) if len(sys.argv) > 1 else DEMO / "beats.json"
    plan = json.loads(beats_file.read_text())
    beats = plan["beats"]

    if notch_state() == "":
        print("!! Notch isn't responding on 127.0.0.1:8737 — is it running?")
        sys.exit(1)

    # 1) pre-generate narration so a mid-run API hiccup can't kill the take
    print("→ generating narration…")
    for b in beats:
        mp3 = NARR / f"{b['id']}.mp3"
        synth(b["narration"], mp3)
        b["narration_dur"] = audio_dur(mp3)
        print(f"   {b['id']}: {b['narration_dur']:.1f}s")

    # 1.5) warm-up: trigger macOS's periodic screen-recording consent NOW,
    # before the timed take, so the "Allow" dialog never lands in-frame.
    # After you click Allow once, macOS stays quiet for ~weeks — every run
    # after the first is fully unattended.
    warm = subprocess.Popen(["screencapture", "-v", "-V", "1", str(RAW / "warmup.mov")],
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL)
    warm.wait()
    countdown = int(cfg("NOTCH_DEMO_COUNTDOWN", "12"))
    print(f"→ if a macOS screen-recording prompt appeared, click Allow now.")
    print(f"   real recording starts in {countdown}s — walk away…")
    time.sleep(countdown)

    # 2) start the screen recording (background; we kill it precisely when done)
    raw = RAW / "session.mov"
    if raw.exists():
        raw.unlink()
    print("→ recording screen…")
    rec = subprocess.Popen(["screencapture", "-v", "-k", str(raw)],
                           stdin=subprocess.DEVNULL)
    time.sleep(2.0)                       # let the recorder warm up
    t0 = time.time()
    def offset():
        return time.time() - t0

    # 3) drive each beat, logging the segment to keep
    segments = []
    for b in beats:
        # each beat's on-screen dwell must cover its narration length
        min_dwell = b["narration_dur"] + 1.2
        start = offset()
        print(f"→ beat '{b['id']}' @ {start:.1f}s")
        if b["command"] == "__OPEN_GRAPH__":
            subprocess.run(["open", BASE + "graph"], check=False)
        elif b["command"] == "__OPEN_CENTER__":
            http_post("open_center", {})            # Command Center window
        else:
            send_command(b["command"])

        # wait for the target state, then settle
        wf = b.get("wait_for", "responding")
        deadline = time.time() + b.get("max_wait", 60)
        if wf == "worker":
            # wait for a worker to spin up, then for the proactive "done"
            while time.time() < deadline and (http_get("state") or {}).get("workers", 0) == 0:
                time.sleep(0.3)
            while time.time() < deadline and (http_get("state") or {}).get("workers", 0) > 0:
                time.sleep(0.5)
        elif wf != "none":
            while time.time() < deadline and notch_state() != wf:
                time.sleep(0.3)
        time.sleep(b.get("settle", 3.0))
        # ensure the beat is at least as long as its narration
        while offset() - start < min_dwell:
            time.sleep(0.2)
        end = offset()
        segments.append({**b, "start": start, "end": end})
        print(f"   held {end-start:.1f}s")
        # collapse the panel between beats for a clean transition
        http_post("cancel", {})
        time.sleep(1.2)

    # 4) stop recording
    time.sleep(1.0)
    rec.send_signal(signal.SIGINT)
    rec.wait(timeout=15)
    total = offset()
    print(f"→ recording stopped ({total:.1f}s raw)")
    time.sleep(1.0)

    # 5) hand off to the cinematic editor. It reads segments.json (the
    # exact cut points we logged) + the recorded raw + narration, and
    # produces the graded, punched-in, kinetically-captioned, scored cut.
    spec = {
        "raw": str(raw.relative_to(DEMO)),
        "segments": [
            {"id": s["id"], "start": round(s["start"], 2), "end": round(s["end"], 2),
             "caption": s["caption"], "punch_in": s.get("punch_in", False)}
            for s in segments
        ],
    }
    (DEMO / "segments.json").write_text(json.dumps(spec, indent=2))
    print("→ editing (cinematic)…")
    subprocess.run([sys.executable, str(DEMO / "cinema.py"), str(DEMO / "segments.json")])

if __name__ == "__main__":
    main()
