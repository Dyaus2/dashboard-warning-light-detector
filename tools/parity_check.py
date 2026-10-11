"""Compare POST /predict with a direct Ultralytics call on the sample photos.

Start the server first (uvicorn app.main:app), then:

    python tools/parity_check.py [http://127.0.0.1:8000]

Passes when both sides agree on the classes, confidences are within 0.03 and
boxes are within 3 px, at the recommended confidence of 0.40.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

os.environ.setdefault("YOLO_OFFLINE", "true")
from ultralytics import YOLO  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "app" / "static" / "samples"
CONF = 0.40
CONF_TOL = 0.03
BOX_TOL = 3.0


def from_api(base: str, path: Path) -> list[dict]:
    request = urllib.request.Request(
        f"{base}/predict", data=path.read_bytes(), headers={"Content-Type": "image/jpeg"}, method="POST"
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.load(response)
    return [d for d in payload["detections"] if d["confidence"] >= CONF]


def from_python(model: YOLO, path: Path) -> list[dict]:
    result = model.predict(str(path), imgsz=960, conf=CONF, device="cpu", verbose=False)[0]
    return [
        {"class_id": int(c), "confidence": float(p), "box": [float(v) for v in b]}
        for b, p, c in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), result.boxes.cls.tolist())
    ]


def compare(api: list[dict], ref: list[dict]) -> tuple[bool, float, float]:
    """Greedy one-to-one match by class and nearest box. Returns (ok, max conf gap, max box gap)."""
    left = list(api)
    worst_conf = worst_box = 0.0
    for r in ref:
        same = [a for a in left if a["class_id"] == r["class_id"]]
        if not same:
            return False, worst_conf, worst_box
        best = min(same, key=lambda a: max(abs(x - y) for x, y in zip(a["box"], r["box"])))
        left.remove(best)
        worst_conf = max(worst_conf, abs(best["confidence"] - r["confidence"]))
        worst_box = max(worst_box, max(abs(x - y) for x, y in zip(best["box"], r["box"])))
    ok = not left and worst_conf <= CONF_TOL and worst_box <= BOX_TOL
    return ok, worst_conf, worst_box


def main() -> int:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
    model = YOLO(str(sorted(ROOT.glob("*.pt"))[0]))
    failures = 0
    for path in sorted(SAMPLES.glob("*.jpg")):
        api, ref = from_api(base, path), from_python(model, path)
        ok, conf_gap, box_gap = compare(api, ref)
        failures += not ok
        print(
            f"{'PASS' if ok else 'FAIL'}  {path.name:<22} api={len(api):>2} python={len(ref):>2} "
            f"max conf gap={conf_gap:.4f}  max box gap={box_gap:.2f}px"
        )
    print("Parity check passed." if not failures else f"Parity check FAILED on {failures} image(s).")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
