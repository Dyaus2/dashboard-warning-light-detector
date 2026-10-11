# Telltale: dashboard warning light detector

A two-page local web app around a trained YOLO11s detector (`best_R4.pt`, 10 classes, 960 px).

- **Metrics** (`/`): how the model performs on real photos, and how it got from the first model to this one.
- **Demo** (`/demo`): upload a dashboard photo and inspect each detection on an interactive overlay.

## Install and run

Windows, Python 3.10 or newer, CPU only. From this folder:

```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --reload-dir app
```

Then open http://127.0.0.1:8000. The first install downloads PyTorch (about 130 MB); after that the app runs offline.

### Sample photos (optional)

The demo page can show a row of six sample photos. They are stock images from the training dataset, so they are
not stored in this repository. To add them, download the YOLOv11 export of
[hfgf v1 on Roboflow Universe](https://universe.roboflow.com/ff-idwm5/hfgf/dataset/1) (CC BY 4.0), put the zip in
this folder as `hfgf.v1i.yolov11.zip`, and run:

```
python tools/copy_samples.py     # fills app/static/samples from the zip
python tools/parity_check.py     # with the server running: /predict against a direct Ultralytics call
```

Without them the demo works the same; you upload your own photo.

## How it fits together

```
app/main.py              FastAPI: "/", "/demo", "/static", and POST "/predict"
app/templates/           metrics.html, demo.html (plain HTML)
app/static/css, js       hand-written CSS and vanilla JS modules, no build step
app/static/data/         metrics.json (every number on the metrics page), classes.json
app/static/samples/      sample photos and samples.json (not in the repo, see above)
app/static/vendor/fonts  Michroma and Barlow (SIL Open Font License), served locally
tools/                   copy_samples.py, parity_check.py
```

**`POST /predict`** takes the raw image bytes as the request body with `Content-Type` `image/jpeg`, `image/png` or
`image/webp`, up to 15 MB. The image is decoded and run in memory and is never written to disk. It returns every
detection with confidence 0.10 or higher (IoU 0.7, 960 px), with boxes in pixels of the original image; the page filters
them with its confidence slider, which starts at the recommended 0.40.

```
curl -X POST -H "Content-Type: image/jpeg" --data-binary @your-photo.jpg http://127.0.0.1:8000/predict
```

The model is loaded once, in the background at startup, from `best_R4.pt` in this folder
(set `MODEL_PATH` to use another file).

## Notes

- All numbers on the metrics page come from `app/static/data/metrics.json`. Edit that file, not the page.
- Add `?motion=off` to either page URL to switch animations off (useful for screenshots). The pages also follow the
  system "reduce motion" setting.
- The tool identifies symbols. It is not a vehicle diagnosis.
