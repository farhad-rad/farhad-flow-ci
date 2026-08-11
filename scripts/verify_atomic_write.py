#!/usr/bin/env python3
"""Thin wrapper — real smoke lives in scripts/git-sot/verify_atomic_write.py."""

from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parent / "git-sot" / "verify_atomic_write.py"), run_name="__main__")
