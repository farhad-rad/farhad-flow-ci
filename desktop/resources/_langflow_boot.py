"""Relocatable entry: standalone python + venv site-packages (.pth aware)."""
import ctypes
import os
import runpy
import site
import sys
from pathlib import Path

_root = Path(__file__).resolve().parent
_site = _root / "venv" / "Lib" / "site-packages"
_python = _root / "python"
_ort_capi = _site / "onnxruntime" / "capi"


def _register_native_dll_dirs() -> None:
    """Pin bundled native DLL search paths before any extension import.

    Dev machines may have a different onnxruntime.dll on PATH/System32 (observed:
    1.17 in System32 vs 1.23 bundled). Without preloading the bundled DLL, magika/
    markitdown fail when custom components import those packages.
    """
    if sys.platform != "win32":
        return
    add_dll = getattr(os, "add_dll_directory", None)
    for directory in (_ort_capi, _python):
        if directory.is_dir() and add_dll is not None:
            add_dll(str(directory))
    ort_dll = _ort_capi / "onnxruntime.dll"
    if ort_dll.is_file():
        ctypes.CDLL(str(ort_dll))


_register_native_dll_dirs()

if _site.is_dir():
    site.addsitedir(str(_site))
sys.argv[0] = "langflow"
runpy.run_module("langflow", run_name="__main__", alter_sys=True)