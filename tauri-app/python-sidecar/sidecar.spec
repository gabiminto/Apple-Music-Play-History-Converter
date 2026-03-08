# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

project_root = Path(SPECPATH).resolve().parents[1]
src_root = project_root / "src"
sidecar_script = project_root / "tauri-app" / "python-sidecar" / "sidecar.py"

sys.path.insert(0, str(src_root))

datas = collect_data_files("apple_music_history_converter")
datas += collect_data_files("certifi")
datas += collect_data_files("charset_normalizer")
datas += collect_data_files("chardet")
hiddenimports = collect_submodules("apple_music_history_converter")
hiddenimports += collect_submodules("charset_normalizer")
hiddenimports += collect_submodules("chardet")

a = Analysis(
    [str(sidecar_script)],
    pathex=[str(project_root), str(src_root)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
)
