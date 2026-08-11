"""Manual smoke: atomic_write + canonical hash + FlowGitStore (no full langflow import)."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "src" / "backend" / "base" / "langflow" / "services" / "flow_git"


def _ensure_pkg(name: str) -> None:
    if name not in sys.modules:
        mod = types.ModuleType(name)
        mod.__path__ = []  # type: ignore[attr-defined]
        sys.modules[name] = mod


def _load(mod_name: str, file_name: str):
    path = PKG / file_name
    spec = importlib.util.spec_from_file_location(mod_name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = mod
    spec.loader.exec_module(mod)
    return mod


# Namespace packages so relative imports inside flow_git modules resolve
for name in (
    "langflow",
    "langflow.services",
    "langflow.services.flow_git",
):
    _ensure_pkg(name)

# Load leaf modules in dependency order
_load("langflow.services.flow_git.paths", "paths.py")
_load("langflow.services.flow_git.canonical", "canonical.py")
_load("langflow.services.flow_git.atomic", "atomic.py")
_load("langflow.services.flow_git.lockfile", "lockfile.py")
_load("langflow.services.flow_git.auto_commit", "auto_commit.py")
store_mod = _load("langflow.services.flow_git.store", "store.py")

atomic_write = sys.modules["langflow.services.flow_git.atomic"].atomic_write
canonical_json_bytes = sys.modules["langflow.services.flow_git.canonical"].canonical_json_bytes
sha256_raw = sys.modules["langflow.services.flow_git.canonical"].sha256_raw
read_lock = sys.modules["langflow.services.flow_git.lockfile"].read_lock
assert_lock_matches_tree = sys.modules["langflow.services.flow_git.lockfile"].assert_lock_matches_tree
FlowGitStore = store_mod.FlowGitStore


def main() -> int:
    sample = {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Smoke",
        "description": None,
        "data": {"nodes": [], "edges": [], "z": 1, "a": 2},
        "tags": ["b", "a"],
    }
    raw = canonical_json_bytes(sample)
    assert b"\r" not in raw, "CRLF leaked into canonical bytes"
    expected = json.dumps(
        {
            "data": {"a": 2, "edges": [], "nodes": [], "z": 1},
            "description": None,
            "id": "11111111-1111-1111-1111-111111111111",
            "name": "Smoke",
            "tags": ["b", "a"],
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    assert raw == expected, (raw, expected)
    digest = sha256_raw(raw)
    assert digest == hashlib.sha256(raw).hexdigest()

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        target = root / "flows" / "x.json"
        atomic_write(target, raw)
        assert target.read_bytes() == raw
        assert not list(target.parent.glob(".*.staging"))

        store = FlowGitStore(root)
        sha = store.write_flow(sample)
        assert sha == digest
        assert store.flow_path_for_id(sample["id"]).exists()
        lock = read_lock(root)
        assert sample["id"] in lock.flows
        assert lock.flows[sample["id"]].sha256 == digest
        problems = assert_lock_matches_tree(root)
        assert not problems, problems

        p = store.flow_path_for_id(sample["id"])
        p.write_bytes(b'{"tampered":true}')
        problems = assert_lock_matches_tree(root)
        assert problems, "expected mismatch"

        store.delete_flow(sample["id"])
        assert not p.exists()
        lock2 = read_lock(root)
        assert sample["id"] not in lock2.flows
        trash_hits = list((root / ".langflow" / "trash").glob(f"{sample['id']}.*.json"))
        assert trash_hits, "expected trash backup after delete"

    print("OK verify_atomic_write + FlowGitStore smoke")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
