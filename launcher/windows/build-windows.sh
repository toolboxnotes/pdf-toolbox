#!/bin/sh
# Cross-compile the Windows launcher (needs zig: pip install ziglang)
cd "$(dirname "$0")"
ZIG="${ZIG:-python3 -m ziglang}"
$ZIG cc -target x86_64-windows-gnu -O2 -municode -s -Wl,--subsystem,windows -o "PDF Toolbox.exe" launcher.c app.rc -ladvapi32 -lshell32 -luser32
