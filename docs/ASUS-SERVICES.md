# ASUS service persistence

The ASUS deployment now uses two user systemd units for the existing runtime in
`/home/asus/rewind-eval-20260919`:

| Unit | Purpose | Loopback port |
| --- | --- | --- |
| `rewind-vision.service` | Native CUDA Qwen3.5 35B-A3B, eight slots with 32,768 tokens per slot | 11436 |
| `rewind-processing.service` | Authenticated image, audio, retrieval and question API | 11440 |

The existing system `ollama.service` on port 11434 remains separate. It supplies
the configured embedding model. These units do not stop Ollama, download weights,
change its configuration, or expose inference ports to the public network.

Both units are enabled on `gx10-f3bc`. `loginctl show-user asus -p Linger` returned
`Linger=yes`: the user manager is configured to start at boot and survive logout.
The account could authorize its own linger setting without sudo. Startup and
authenticated readiness were checked after switching from detached processes to
systemd. An actual machine reboot was not performed during validation.

## Reproduce or update the installation

Copy the repository's `scripts/install_asus_services.py`, `scripts/serve_vision.py`
and `deploy/systemd/*.service.in` into the corresponding directories on the ASUS.
The existing virtual environment, model weights, CUDA runtime,
`qwen35-chat-template.jinja`, and private `asus-processing.env` are prerequisites.
The installer checks those files, verifies rendered units with systemd, and never
prints the private environment contents. Keep that environment file owned by
`asus` with mode 600; it must never be committed.

Run as the `asus` user on the ASUS:

```sh
cd /home/asus/rewind-eval-20260919
.venv/bin/python scripts/install_asus_services.py --render-only
.venv/bin/python scripts/install_asus_services.py --enable --enable-linger
.venv/bin/python scripts/install_asus_services.py --start
```

Preview mode writes validated units under `data/systemd-preview` without changing
the service manager. Normal installation writes `~/.config/systemd/user`, reloads
the manager, and changes enable/start/linger state only when requested by the
corresponding flag. If linger authorization is unavailable, the installer reports
that fact and exits with status 2; enabled user units alone do not establish
startup before a user logs in.

`--start` refuses a port occupied by a process outside an already active unit.
It never kills or adopts detached processes. For an older detached deployment,
first arrange a quiet cutover, verify ownership and command lines, stop those
specific processes, and then start these units. A second model loaded in Ollama
can waste unified memory; unload only the known Qwen vision model if it was left
over from a comparison. Never stop unrelated models or the system Ollama service
as part of this installer.

## Operate and inspect

```sh
systemctl --user status rewind-vision.service rewind-processing.service
systemctl --user is-enabled rewind-vision.service rewind-processing.service
loginctl show-user asus -p Linger
systemctl --user restart rewind-processing.service
systemctl --user restart rewind-vision.service
journalctl --user -u rewind-processing.service -n 50 --no-pager
journalctl --user -u rewind-vision.service -n 50 --no-pager
```

The units restart a failed process after five seconds, with a limit of eight
starts in five minutes to avoid an unlimited failure loop. The native launcher
still refuses CPU fallback and requires 45 GiB of free unified memory. It never
evicts another workload to meet that requirement. After correcting repeated
startup failures, use `systemctl --user reset-failed` before starting again.

Each native startup writes a new JSON report under `data/service-launches`; the
`--report-dir` option avoids the previous single-use report filename preventing
restart. Reports record the model manifest, CUDA device discovery, launch command
and context settings. Originals, tokens and account data do not belong in these
reports. Unit logs stay in the journal; application logs should still be treated
as private because they can contain request diagnostics.

An active systemd process is not the same as a ready model. Native `/health` on
11436 must return `ok`; authenticated processing `/health` on 11440 must report
`ready: true` with the intended model. During native loading, the processing API
can run while truthfully reporting that vision is not ready. Failure restart is
configured by systemd; an intentional crash or a full reboot was not used to
test it on the live machine.

These units only supervise ASUS inference. The Mac phone server, Notch, Codex
review jobs, and the SSH/Tailscale forwarding supervisor remain separate parts
of the system and must also be running for the complete phone experience.
