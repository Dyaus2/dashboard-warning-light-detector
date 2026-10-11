"""Dashboard warning light detector: two pages and one inference route.

    uvicorn app.main:app --reload

"/"         metrics page
"/demo"     demo page
"/static"   css, js, data, samples, vendored fonts
"/predict"  POST an image body, get detections as JSON
"""
from __future__ import annotations

import io
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
TEMPLATES = APP_DIR / "templates"
STATIC = APP_DIR / "static"

IMGSZ = 960
MIN_CONF = 0.10  # everything at or above this is returned; the UI filters with its slider
NMS_IOU = 0.7  # Ultralytics default, the setting the metrics were measured with
MAX_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 50_000_000
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

EXPECTED_NAMES = [
    "Anti Lock Braking System",
    "Braking System Issue",
    "Charging System Issue",
    "Check Engine",
    "Electronic Stability Problem -ESP-",
    "Engine Overheating Warning Light",
    "Low Engine Oil Warning Light",
    "Low Tire Pressure Warning Light",
    "Master warning light",
    "SRS-Airbag",
]

_model = None
_model_lock = threading.Lock()


def _model_path() -> Path:
    override = os.environ.get("MODEL_PATH")
    if override:
        return Path(override)
    weights = sorted(ROOT.glob("*.pt"))
    if not weights:
        raise RuntimeError(f"No .pt model file found in {ROOT}")
    return weights[0]


def get_model():
    """Load the detector once per process. Callers must hold _model_lock."""
    global _model
    if _model is None:
        # Skip Ultralytics' connectivity probe, update checks and usage pings: the app runs offline.
        os.environ.setdefault("YOLO_OFFLINE", "true")
        from ultralytics import YOLO  # imported lazily so the pages come up before torch does

        model = YOLO(str(_model_path()))
        names = [model.names[i] for i in sorted(model.names)]
        if names != EXPECTED_NAMES:
            raise RuntimeError(f"Unexpected class names in model: {names}")
        # One blank pass so the first real request does not pay for graph warm-up.
        model.predict(Image.new("RGB", (64, 64)), imgsz=IMGSZ, device="cpu", verbose=False)
        _model = model
    return _model


def _warm_up() -> None:
    try:
        with _model_lock:
            get_model()
    except Exception as exc:  # reported again, with a 503, on the first /predict
        print(f"[model] warm-up failed: {exc}")


@asynccontextmanager
async def lifespan(_: FastAPI):
    threading.Thread(target=_warm_up, name="model-warm-up", daemon=True).start()
    yield


app = FastAPI(
    title="Dashboard warning light detector",
    lifespan=lifespan,
    docs_url=None,  # the bundled docs pages load assets from a CDN; the app must work offline
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def revalidate_static(request: Request, call_next):
    response = await call_next(request)
    if request.method == "GET":
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/", include_in_schema=False)
def metrics_page() -> FileResponse:
    return FileResponse(TEMPLATES / "metrics.html")


@app.get("/demo", include_in_schema=False)
def demo_page() -> FileResponse:
    return FileResponse(TEMPLATES / "demo.html")


async def _read_body(request: Request) -> bytes:
    """Read the upload into memory, refusing to buffer more than MAX_BYTES."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(413, "Image is larger than 15 MB.")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_BYTES:
            raise HTTPException(413, "Image is larger than 15 MB.")
        chunks.append(chunk)
    if size == 0:
        raise HTTPException(400, "Empty request body. Send the image bytes as the body.")
    return b"".join(chunks)


def _looks_like_image(data: bytes) -> bool:
    """Check the magic bytes for JPEG, PNG or WebP before handing anything to a decoder."""
    return (
        data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"\x89PNG\r\n\x1a\n")
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


def _decode(data: bytes) -> Image.Image:
    if not _looks_like_image(data):
        raise HTTPException(400, "Could not read that file as an image.")
    try:
        image = Image.open(io.BytesIO(data))
        if image.format not in ALLOWED_FORMATS:
            raise HTTPException(415, "Unsupported image type. Use JPEG, PNG or WebP.")
        if image.width * image.height > MAX_PIXELS:
            raise HTTPException(413, "Image has too many pixels (limit 50 megapixels).")
        # Apply the EXIF rotation so boxes line up with what the browser displays.
        image = ImageOps.exif_transpose(image)
        return image.convert("RGB")
    except HTTPException:
        raise
    except Exception:
        # Deliberately broad: the bytes are untrusted, and Ultralytics patches Image.open to try
        # optional decoders (pi-heif) on failure, so the error type is not limited to Pillow's own.
        raise HTTPException(400, "Could not read that file as an image.") from None


def _infer(data: bytes) -> dict:
    image = _decode(data)
    with _model_lock:
        model = get_model()
        started = time.perf_counter()
        result = model.predict(
            image, imgsz=IMGSZ, conf=MIN_CONF, iou=NMS_IOU, device="cpu", verbose=False
        )[0]
        elapsed_ms = (time.perf_counter() - started) * 1000

    boxes = result.boxes
    detections = [
        {
            "class_id": int(cls),
            "name": model.names[int(cls)],
            "confidence": round(float(conf), 4),
            "box": [round(float(v), 1) for v in xyxy],
        }
        for xyxy, conf, cls in zip(boxes.xyxy.tolist(), boxes.conf.tolist(), boxes.cls.tolist())
    ]
    detections.sort(key=lambda d: d["confidence"], reverse=True)
    return {
        "image": {"width": image.width, "height": image.height},
        "backend": "PyTorch CPU",
        "inference_ms": round(elapsed_ms),
        "detections": detections,
    }


@app.post("/predict")
async def predict(request: Request) -> dict:
    """Body: the raw image bytes (JPEG, PNG or WebP), with a matching Content-Type.

    The image is decoded and run in memory and is never written to disk.
    Boxes are [x1, y1, x2, y2] in pixels of the (EXIF-rotated) original image.
    """
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(415, "Unsupported image type. Use JPEG, PNG or WebP.")
    data = await _read_body(request)
    try:
        return await run_in_threadpool(_infer, data)
    except RuntimeError as exc:
        raise HTTPException(503, f"Model is not available: {exc}") from None
