#!/usr/bin/env python3
"""Start a Claude Code cloud session from a non-interactive process.

A trimmed copy of podstow's .github/scripts/dispatch-remote.py, whose docstring
explains each step: `claude --cloud` needs a TTY (without one it runs locally),
so it runs in a pseudo-terminal; the prompt is the --cloud flag's value; --ref
pins the session to a revision so a failed GitHub preflight refuses instead of
uploading the working tree; DISABLE_GROWTHBOOK=1 is podstow's workaround for the
GitHub App preflight; and we exit once the CLI prints "Resume with:".

Usage: launch.py <prompt-file>     (run from the workspace whose origin is the repo)
Env:   CLAUDE_PERMISSION_MODE (default auto), CLAUDE_REF (default main),
       CLAUDE_SESSION_NAME, CLAUDE_MODEL
Exit:  0 confirmed; 3 unconfirmed (a session may exist); anything else, nothing started.
"""
import os
import pty
import re
import select
import signal
import sys
import time

MARKER = b"Resume with:"
TRUST_PROMPT = b"yes,itrustthisfolder"
ESCAPE = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]")

if len(sys.argv) != 2:
    print(f"Usage: {sys.argv[0]} <prompt-file>", file=sys.stderr)
    sys.exit(1)
prompt = open(sys.argv[1]).read()

cmd = ["claude", "--permission-mode", os.environ.get("CLAUDE_PERMISSION_MODE") or "auto",
       "--ref", os.environ.get("CLAUDE_REF") or "main"]
if os.environ.get("CLAUDE_MODEL"):
    cmd += ["--model", os.environ["CLAUDE_MODEL"]]
if os.environ.get("CLAUDE_SESSION_NAME"):
    cmd += ["--name", os.environ["CLAUDE_SESSION_NAME"]]
cmd += ["--cloud", prompt]
os.environ["DISABLE_GROWTHBOOK"] = "1"


def forward(fd, seconds):
    """Keep reading (and echoing) for `seconds`, so claude can finish uploading the prompt."""
    until = time.monotonic() + seconds
    while (left := until - time.monotonic()) > 0:
        try:
            if not select.select([fd], [], [], left)[0]:
                return
            chunk = os.read(fd, 4096)
            if not chunk:
                return
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
        except OSError:
            return


pid, fd = pty.fork()
if pid == 0:
    os.closerange(3, 1024)
    os.execvp("claude", cmd)

status, untrusted, buf, tail = 1, False, b"", b""
deadline = time.monotonic() + 240
while True:
    left = deadline - time.monotonic()
    if left <= 0:
        status = 3
        break
    try:
        if not select.select([fd], [], [], min(30.0, left))[0]:
            status = 3
            break
        chunk = os.read(fd, 4096)
        if not chunk:
            break
    except OSError:
        break
    sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()
    buf = buf[-(len(MARKER) - 1):] + chunk
    tail = (tail + chunk)[-4096:]
    if TRUST_PROMPT in re.sub(rb"\s+", b"", ESCAPE.sub(b"", tail)).lower():
        untrusted = True
        break
    if MARKER in buf:
        forward(fd, 5.0)
        status = 0
        break

if untrusted:
    print(f"claude stopped at the folder-trust prompt in {os.getcwd()}: run `claude` there "
          "(or in a folder above it) once and accept", file=sys.stderr)
try:
    os.close(fd)
except OSError:
    pass
for _ in range(200):
    try:
        if os.waitpid(pid, os.WNOHANG)[0]:
            sys.exit(status)
    except ChildProcessError:
        sys.exit(status)
    time.sleep(0.01)
try:
    os.killpg(os.getpgid(pid), signal.SIGKILL)
except OSError:
    pass
try:
    os.waitpid(pid, 0)
except ChildProcessError:
    pass
sys.exit(status)
