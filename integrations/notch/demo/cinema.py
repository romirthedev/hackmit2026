#!/usr/bin/env python3
"""
Cinematic editor for the Notch demo. Takes recorded segments + narration,
produces a graded, punched-in, kinetically-captioned, music-scored cut.

Runs standalone against already-recorded footage so the look can be
iterated without re-capturing:  python3 cinema.py segments.json
"""
import json, subprocess, sys
from pathlib import Path
import director   # reuse its synth() / config helpers

# Narration voice: a warm female narrator, INDEPENDENT of Notch's own TTS
# voice (which the demo itself changes on camera). "Rachel".
NARRATION_VOICE = "21m00Tcm4TlvDq8ikWAM"
director.EL_VOICE = NARRATION_VOICE

DEMO = Path(__file__).resolve().parent
NARR = DEMO / "narration"; CLIPS = DEMO / "clips"; OUT = DEMO / "out"; AUDIO = DEMO / "audio"
for d in (CLIPS, OUT, AUDIO):
    d.mkdir(exist_ok=True)
FONT = "/System/Library/Fonts/SFNS.ttf"
FONTB = "/System/Library/Fonts/SFNS.ttf"
FPS = 30
TITLE = "Notch"
TAGLINE = "The laptop is the assistant."
CLOSING = "Built with Fable 5 in Claude Code."
CLOSING2 = "The laptop is the assistant."

def run(args):
    return subprocess.run(args, capture_output=True, text=True)

def dur(path):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nk=1:nw=1", str(path)])
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 3.0

def esc(s):
    return s.replace("\\", "\\\\").replace("'", "’").replace(":", "\\:").replace(",", "\\,")

# Color grade shared by every beat — deep blacks, cool-ish, punchy.
# (curves black=/white= options don't exist in ffmpeg 8; eq alone grades.)
GRADE = "eq=contrast=1.10:saturation=1.14:brightness=-0.015:gamma=0.97"

# Punch-in crop centered on the top notch panel (Retina pixels).
PUNCH_CROP = "crop=1636:920:892:0"

def kinetic_caption(text, dur_s):
    """Big drop-shadow caption that rises + fades in, lower third.
    Every expression with commas (min/max) MUST be single-quoted, or the
    filtergraph parser splits the filter on those commas."""
    t = esc(text)
    # slides up 28px over .45s, then holds
    y_fg = "'h-140+min(0,-(28*(1-min(1,(t-0.25)/0.45))))'"
    y_sh = "'h-140+min(0,-(28*(1-min(1,(t-0.25)/0.45))))+3'"
    a = "'min(1,max(0,(t-0.25)/0.45))'"
    shadow = (f"drawtext=text='{t}':fontfile={FONTB}:fontsize=52:fontcolor=black@0.6:"
              f"x='(w-tw)/2+3':y={y_sh}:alpha={a}")
    fg = (f"drawtext=text='{t}':fontfile={FONTB}:fontsize=52:fontcolor=white:"
          f"x='(w-tw)/2':y={y_fg}:alpha={a}")
    return shadow + "," + fg

def process_beat(raw, seg, idx):
    clip = CLIPS / f"{idx:02d}_{seg['id']}.mp4"
    raw_len = seg["end"] - seg["start"]
    narr = NARR / f"{seg['id']}.mp3"
    n_len = dur(narr)

    # SPEED-RAMP: the beat's on-screen time is set by the narration, not the
    # raw capture. Long "thinking" gaps fast-forward (time-lapse look) to fit
    # the voiceover — this is the "cut through the waiting" the demo needs.
    target = max(n_len + 1.2, 4.0)
    speed = raw_len / target if raw_len > target else 1.0   # >1 = compress time
    setpts = f"setpts=(1/{speed:.4f})*PTS" if speed > 1.0 else "setpts=PTS"
    length = target

    # FRAMING: static crop, NO zoompan. zoompan integer-rounds the crop
    # window each frame, which is exactly what made the footage shake.
    if seg.get("punch_in"):
        frame = f"{PUNCH_CROP},scale=1920:1080"
    else:
        frame = ("scale=1920:1080:force_original_aspect_ratio=decrease,"
                 "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black")

    cap = kinetic_caption(seg["caption"], length)
    vf = (f"{frame},{setpts},fps={FPS},{GRADE},{cap},"
          f"fade=t=in:st=0:d=0.5,fade=t=out:st={length-0.5:.2f}:d=0.5,format=yuv420p")
    # every clip carries audio (narration boosted + trailing silence) so
    # concat keeps a uniform audio stream
    run(["ffmpeg", "-y",
         "-ss", f"{seg['start']:.2f}", "-t", f"{raw_len:.2f}", "-i", str(raw),
         "-i", str(narr),
         "-filter_complex",
         f"[0:v]{vf}[v];"
         f"[1:a]volume=1.6,adelay=350|350,apad,atrim=0:{length:.2f},"
         f"aformat=sample_rates=44100:channel_layouts=stereo[a]",
         "-map", "[v]", "-map", "[a]", "-t", f"{length:.2f}",
         "-r", str(FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-ar", "44100", str(clip)])
    return clip if clip.exists() else None

def make_title(path):
    """Cold-open: black → glow → NOTCH scales in → tagline → hold."""
    d = 4.0
    # a soft radial glow that breathes, the title scaling up with fade,
    # tagline fading in beneath. Silent audio track so concat keeps audio.
    title = esc(TITLE); tag = esc(TAGLINE)
    # static font sizes (animated fontsize segfaults drawtext); the
    # "scale-in" comes from a gentle zoompan push on the whole card.
    vf = (
        f"drawtext=text='{title}':fontfile={FONTB}:fontsize=132:"
        f"fontcolor=white:x=(w-tw)/2:y=(h-th)/2-40:alpha='min(1,t/0.8)',"
        f"drawtext=text='{tag}':fontfile={FONT}:fontsize=40:fontcolor=0x9BB4FF:"
        f"x=(w-tw)/2:y=(h/2)+70:alpha='max(0,min(1,(t-0.9)/0.8))',"
        f"zoompan=z='min(1.0+0.04*on/({FPS}*{d}),1.04)':d=1:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps={FPS},"
        f"fade=t=out:st={d-0.6:.2f}:d=0.6"
    )
    run(["ffmpeg", "-y",
         "-f", "lavfi", "-i", f"color=c=0x050507:s=1920x1080:d={d}:r={FPS}",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
         "-vf", vf, "-t", f"{d}", "-map", "0:v", "-map", "1:a",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100",
         "-shortest", str(path)])
    return path

def make_endcard(path):
    d = 4.0
    a = esc(CLOSING); b = esc(CLOSING2)
    vf = (
        f"drawtext=text='{b}':fontfile={FONTB}:fontsize=64:fontcolor=white:"
        f"x=(w-tw)/2:y=(h-th)/2-20:alpha='min(1,t/0.8)',"
        f"drawtext=text='{a}':fontfile={FONT}:fontsize=34:fontcolor=0x8899AA:"
        f"x=(w-tw)/2:y=(h/2)+60:alpha='max(0,min(1,(t-0.6)/0.8))',"
        f"fade=t=in:st=0:d=0.5,fade=t=out:st={d-0.8:.2f}:d=0.8"
    )
    run(["ffmpeg", "-y",
         "-f", "lavfi", "-i", f"color=c=0x050507:s=1920x1080:d={d}:r={FPS}",
         "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
         "-vf", vf, "-t", f"{d}", "-map", "0:v", "-map", "1:a",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100",
         "-shortest", str(path)])
    return path

def make_music(total, path):
    """Drop-in override: audio/music.mp3 wins if present. Else synthesize."""
    override = AUDIO / "music.mp3"
    if override.exists():
        run(["ffmpeg", "-y", "-stream_loop", "-1", "-i", str(override),
             "-t", f"{total:.2f}", "-af", f"afade=t=out:st={total-3:.2f}:d=3",
             "-c:a", "pcm_s16le", str(path)])
        return path
    fade = 6
    run(["ffmpeg", "-y",
         "-f", "lavfi", "-i", "sine=frequency=110:sample_rate=44100",
         "-f", "lavfi", "-i", "sine=frequency=164.81:sample_rate=44100",
         "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=44100",
         "-f", "lavfi", "-i", "aevalsrc=exprs=0.8*sin(2*PI*52*t)*exp(-9*mod(t\\,0.5)):sample_rate=44100",
         "-filter_complex",
         "[0:a][1:a][2:a]amix=inputs=3:weights='1 0.7 0.5'[p0];"
         "[p0]lowpass=f=520,tremolo=f=0.12:d=0.5,aecho=0.8:0.85:400|700:0.4|0.25,volume=0.5[pad];"
         "[3:a]lowpass=f=120,volume=0.7[kick];"
         f"[pad][kick]amix=inputs=2:weights='1 0.8':normalize=0,"
         f"volume='min(1,t/{fade})*min(1,({total:.2f}-t)/{fade})':eval=frame,alimiter=limit=0.9[out]",
         "-map", "[out]", "-t", f"{total:.2f}", "-c:a", "pcm_s16le", str(path)])
    return path

def main():
    spec = json.loads(Path(sys.argv[1] if len(sys.argv) > 1 else "segments.json").read_text())
    raw = DEMO / spec["raw"]

    clips = []
    title = make_title(CLIPS / "00_title.mp4"); clips.append(title)
    for i, seg in enumerate(spec["segments"], 1):
        c = process_beat(raw, seg, i)
        if c:
            clips.append(c)
            print(f"  beat {i} {seg['id']} ✓")
    end = make_endcard(CLIPS / "99_end.mp4"); clips.append(end)

    # concat (all segments carry audio → audio survives)
    listf = CLIPS / "list.txt"
    listf.write_text("".join(f"file '{c}'\n" for c in clips))
    silent = OUT / "cut_silent.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listf),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
         "-c:a", "aac", "-ar", "44100", str(silent)])

    total = dur(silent)
    music = make_music(total, AUDIO / "bed.wav")

    # mix: narration clearly on top, music ducked under it, then loudnorm to
    # a standard broadcast loudness so it is unmistakably audible on any
    # device (the earlier mix was correct but far too quiet).
    final = OUT / "notch-demo.mp4"
    run(["ffmpeg", "-y", "-i", str(silent), "-i", str(music),
         "-filter_complex",
         "[0:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=1.0[vo];"
         "[1:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=0.28[bed];"
         "[bed][vo]sidechaincompress=threshold=0.04:ratio=10:attack=15:release=350[ducked];"
         "[vo][ducked]amix=inputs=2:weights='1 1':normalize=0,"
         "loudnorm=I=-14:TP=-1.0:LRA=11,alimiter=limit=0.97[mix]",
         "-map", "0:v", "-map", "[mix]",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", str(final)])

    outbox = Path.home() / "NotchOutbox" / "notch-demo.mp4"
    outbox.parent.mkdir(exist_ok=True)
    run(["cp", str(final), str(outbox)])
    print(f"✓ {outbox}  ({total:.1f}s)")

if __name__ == "__main__":
    main()
