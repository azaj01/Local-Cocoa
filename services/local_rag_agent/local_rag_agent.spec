# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for local_rag_agent.
Creates a standalone executable that includes all Python dependencies.
"""

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Collect all submodules that might be dynamically imported
hidden_imports = [
    'uvicorn.logging',
    'uvicorn.loops',
    'uvicorn.loops.auto',
    'uvicorn.protocols',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'uvloop',
    'httptools',
    'watchfiles',
    'websockets',
    'email_validator',
    'multipart',
    'tiktoken_ext',
    'tiktoken_ext.openai_public',
    'PIL',
    'cv2',
    'numpy',
    'qdrant_client',
    'pypdf',
    'docx',
    'markdown_it',
    'markdownify',
    'xxhash',
    'fitz',  # PyMuPDF
    'rapidocr_onnxruntime',
    'onnxruntime',
    'langdetect',
    'markitdown',
    'msal',
    'msal_extensions',
    'azure.identity',
    'msgraph',
]

# Add all submodules for packages that have complex imports
hidden_imports += collect_submodules('uvicorn')
hidden_imports += collect_submodules('fastapi')
hidden_imports += collect_submodules('pydantic')
hidden_imports += collect_submodules('starlette')
hidden_imports += collect_submodules('qdrant_client')
hidden_imports += collect_submodules('tiktoken')
hidden_imports += collect_submodules('rapidocr_onnxruntime')
hidden_imports += collect_submodules('onnxruntime')
hidden_imports += collect_submodules('local_rag_agent')

# Data files needed at runtime
datas = []
datas += collect_data_files('tiktoken')
datas += collect_data_files('rapidocr_onnxruntime')
datas += collect_data_files('onnxruntime')
datas += collect_data_files('langdetect')
datas += collect_data_files('certifi')  # SSL certificates

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter',
        'matplotlib',
        'scipy',
        'pandas',
        'torch',
        'tensorflow',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='local_rag_server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='local_rag_server',
)

