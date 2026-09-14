#!/usr/bin/env python3
"""The interpreter probe that githooks/pre-push uses to pick a working Python.

It must be a SCRIPT rather than a `-c` string, and that is the entire reason
this file exists instead of a flag. Two interpreters on this workspace's
machines answer `-V` correctly and then fail the moment they are handed a
script path:

  - the Windows Store alias stub, which bare `python` AND bare `python3` both
    resolve to on this machine. Measured 2026-08-25: it prints "Python was not
    found" and exits 49, so all 20 Python lines of githooks/checks failed
    identically and every push to cairn--live was refused on the first attempt.
  - the Launcher py.exe on the other machine, which answers `-V` with a real
    version and exits 9009 when given a script. Measured 2026-08-14, recorded
    in memory/global/an-interpreter-that-exists-is-not-one-that-runs.

So `exists()` is not `launchable`, and `-V` is not `runs a script`. The only
question worth asking is the one shaped like the thing you are about to do,
which is why the probe is invoked exactly the way a check line is.

Prints nothing. The exit code is the whole answer - anything this wrote to
stdout would have to be parsed, and a probe that can be misparsed is a probe
that can lie.
"""
import sys

# A version floor, not a preference: the checks use 3.8+ syntax. A too-old
# interpreter must be rejected HERE, where the next candidate is still going to
# be tried, rather than 20 lines later as a SyntaxError that reads like a repo
# defect rather than an environment one.
sys.exit(0 if sys.version_info >= (3, 8) else 1)
