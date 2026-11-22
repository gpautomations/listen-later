#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Zips a built extension folder reproducibly (sorted entries, fixed timestamps).
#   python3 scripts/package.py dist listen-later-extension.zip listen-later-extension
#   python3 scripts/package.py dist-store store/listen-later-store-0.2.0.zip
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
prefix = sys.argv[3] if len(sys.argv) > 3 else ""
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
files = sorted(os.path.relpath(os.path.join(d, f), src) for d, _, fs in os.walk(src) for f in fs)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel in files:
        info = zipfile.ZipInfo(os.path.join(prefix, rel) if prefix else rel, date_time=(2026, 11, 21, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        with open(os.path.join(src, rel), "rb") as f:
            z.writestr(info, f.read(), compresslevel=9)
print(out, os.path.getsize(out), "bytes,", len(files), "files")
