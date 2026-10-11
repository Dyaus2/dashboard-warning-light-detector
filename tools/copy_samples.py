"""Copy the six demo photos out of the v1 Roboflow zip into app/static/samples/.

Reads only the entries it needs; the archive is never extracted in full.
Also writes samples.json (file name, title, size) for the demo page.

    python tools/copy_samples.py
"""
from __future__ import annotations

import io
import json
import sys
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "static" / "samples"

# (name prefix inside the zip, output file stem, title shown under the thumbnail)
SAMPLES = [
    ("stock-photo-car-dashboard-light-symbols-background-1689839530_jpg", "cluster-symbols", "Cluster, many lights"),
    ("abs-light-car-dashboard-closeup-260nw-440293648_jpg", "abs-closeup", "ABS close-up"),
    ("Screenshot-2022-05-18-103810_png", "screenshot", "Screenshot"),
    ("dc_odometer_mileage_1UAI21Q2GLYQEW76_jpg", "odometer", "Odometer view"),
    ("car-dashboard-airbag-error-warning-260nw-1948457068_jpg", "airbag-warning", "Airbag warning"),
    ("alert-car-signs-icons-light-260nw-1295588488_jpg", "alert-signs", "Alert signs"),
]


def main() -> int:
    zips = sorted(ROOT.glob("hfgf*.zip"))
    if not zips:
        print("Missing input: hfgf*.zip (the v1 Roboflow export)")
        return 1

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    with zipfile.ZipFile(zips[0]) as zf:
        images = [n for n in zf.namelist() if "/images/" in n and not n.endswith("/")]
        for prefix, stem, title in SAMPLES:
            hits = [n for n in images if n.rsplit("/", 1)[-1].startswith(prefix + ".rf.")]
            if not hits:
                print(f"Not found in zip: {prefix}")
                return 1
            entry = sorted(hits)[0]
            data = zf.read(entry)
            with Image.open(io.BytesIO(data)) as im:
                width, height = im.size
            suffix = Path(entry).suffix.lower() or ".jpg"
            target = OUT / f"{stem}{suffix}"
            target.write_bytes(data)
            manifest.append(
                {"file": target.name, "title": title, "width": width, "height": height, "source": entry}
            )
            print(f"{entry}  ->  {target.relative_to(ROOT)}  ({width}x{height})")

    (OUT / "samples.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
