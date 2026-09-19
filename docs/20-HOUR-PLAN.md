# A working prototype within 20 hours

The software is implemented. The remaining schedule is for hardware bring-up, model installation, tuning and a reliable demo. These are time-boxes, not a guarantee that unknown hardware will work. The main path does not depend on 3D or extra microphone wiring.

| Window | Work | Pass condition / fallback |
|---|---|---|
| 0–2 h | Identify ASUS GPU/OS; start local server and Ollama; build dashboard; download weights | Login works; a real JPEG produces a description. If the larger model installation stalls, temporarily use the smaller open-weight `qwen3.5:9b` for bring-up while fixing GPU setup; recordings remain queued until inference is available. |
| 2–4 h | Flash camera; insert SD; configure private hotspot and battery | At least 100 real frames arrive. Disconnect Wi-Fi for 60 seconds, reconnect, confirm queue drains without duplicate records. |
| 4–7 h | Tune focus, exposure, capture rate and model | Wallet/notebook questions cite the correct frame. Measure seconds/frame and decrease capture rate if queue grows. Preserve every captured frame. |
| 7–9 h | Computer microphone and transcription; ask aloud | Record a known sentence, replay the original, verify transcript and recall answer. Use computer mic if wearable mic is unavailable. |
| 9–12 h | Optional INMP441 and/or bounded LingBot scan | Spend no more than 90 minutes on the first successful GPU reconstruction. If geometry fails, retain the working evidence timeline as the demo centerpiece. |
| 12–15 h | Monitoring rules and full scenario | Move wallet/notebook/bag; ask what happened before an anchor event; verify uncertainty for occluded objects. A clear live trigger produces an alert. |
| 15–18 h | Endurance and faults | Battery run, Wi-Fi interruption, server restart, full-disk simulation in tests, all queued media either processed or visibly failed. |
| 18–20 h | Freeze demo configuration and rehearse | Perform the same short demo twice with another person moving objects; keep a known recorded session as offline fallback. |

## Demo sequence

1. Power the necklace from the battery. Show “Necklace connected” and received/analyzed counts.
2. Capture a slow table scan if 3D is enabled; dock the camera with a clear view.
3. Put a wallet next to a notebook. Move them while the camera records.
4. Ask “Where was the wallet before I moved the notebook?” Open the cited frame. Do not hide ambiguity if more than one move fits.
5. Record a short project conversation with the computer mic, then ask what was discussed. Play the cited original audio to establish what was actually said.
6. Create “Tell me if I pick up my bag while my wallet is visibly on the table.” Trigger it in clear view.
7. Turn Wi-Fi off briefly, reconnect, and show the buffered queue draining. If inference lags, show that plainly.

## Acceptance gates

- Board pinout confirmed; camera runs on battery with a readable image.
- No credentials in Git or browser source; device token cannot read personal memory.
- Every received JPEG is durably saved and has its own analysis job.
- Retry of the same packet returns the same ID; conflicting data is rejected.
- One real visual recall and one real audio recall are verified against originals.
- Queues remain bounded over the rehearsal, or capture interval is increased.
- Missing or occluded evidence yields uncertainty, not a fabricated exact answer.
- 3D is explicitly optional until actual GPU inference and recognizable geometry pass.

The core target is wireless visual memory + computer audio + evidence-backed recall. Perfect recall, 30 fps exhaustive vision-language reasoning, autonomous dynamic mapping, reliable cross-scene object identity, arbitrary speaker identification, and 20 hours of battery life are not established by this prototype.
