// Demo page: send a photo to POST /predict, then draw the detections as an interactive overlay.

import { clamp, el, loadClasses, loadJSON, reducedMotion, svg, tween } from "./common.js";
import { classChip, iconMarkup } from "./icons.js";

window.__appStarted = true;

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 15 * 1024 * 1024;
const MIN_SCAN_MS = 750; // let the sweep read as a scan even when the model answers instantly
const MIN_HIT_PX = 30; // small lights get a hover target bigger than their box
const BOX_PAD_PX = 3; // drawn boxes sit just outside the light, so the outline never covers it
const TINY_PX = 26; // below this displayed size a box loses its corner brackets

const $ = (id) => document.getElementById(id);
const dom = {
  workspace: $("workspace"),
  stage: $("stage"),
  dropzone: $("dropzone"),
  file: $("file"),
  frame: $("frame"),
  photo: $("photo"),
  overlay: $("overlay"),
  tags: $("tags"),
  card: $("card"),
  cardChip: $("card-chip"),
  cardName: $("card-name"),
  cardFull: $("card-full"),
  cardPct: $("card-pct"),
  cardMeaning: $("card-meaning"),
  scanStatus: $("scan-status"),
  meta: $("meta"),
  another: $("another"),
  alert: $("alert"),
  alertText: $("alert-text"),
  alertRetry: $("alert-retry"),
  samples: $("samples"),
  count: $("count"),
  threshold: $("threshold"),
  thresholdOut: $("threshold-out"),
  labels: $("labels"),
  list: $("list"),
  emptyResult: $("empty-result"),
  emptyText: $("empty-text"),
  emptyAction: $("empty-action"),
  legend: $("legend"),
  legendList: $("legend-list"),
  disclaimer: $("disclaimer"),
};

const state = {
  classes: null,
  dets: [], // sorted by confidence, highest first: { i, cls, confidence, box: [x1, y1, x2, y2] }
  size: { w: 1, h: 1 }, // image pixels; the overlay's coordinate system
  threshold: Number(dom.threshold.value),
  hover: -1,
  pinned: -1,
  blob: null,
  objectUrl: null,
  run: 0,
  controller: null,
};

// DOM nodes per detection index
const nodes = { boxes: [], hits: [], focus: [], rects: [], corners: [], rows: [], items: [], tags: [] };
let dimPath = null;
let leader = null;
let cardFor = -1;
let cancelPct = () => {};

const pct = (confidence) => `${Math.round(confidence * 100)}%`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setState = (name) => (dom.workspace.dataset.state = name);

// ---- upload -----------------------------------------------------------------------------------

function showAlert(message, { retry = false } = {}) {
  dom.alertText.textContent = message;
  dom.alertRetry.hidden = !retry;
  dom.alert.hidden = false;
}

function clearAlert() {
  dom.alert.hidden = true;
}

function describeRejection(blob) {
  if (/hei[cf]/i.test(blob.type) || /\.hei[cf]$/i.test(blob.name ?? "")) {
    return "HEIC photos are not supported. Convert the photo to JPEG first, then try again.";
  }
  return "That file type is not supported. Use a JPEG, PNG or WebP image.";
}

async function analyse(blob, { sample = null } = {}) {
  clearAlert();
  if (!ALLOWED_TYPES.includes(blob.type)) return showAlert(describeRejection(blob));
  if (blob.size > MAX_BYTES) {
    return showAlert(`That image is ${(blob.size / 1024 / 1024).toFixed(1)} MB. The limit is 15 MB.`);
  }

  const run = ++state.run;
  state.controller?.abort();
  const controller = (state.controller = new AbortController());
  state.blob = blob;
  clearResult();
  markSample(sample);

  // Show the photo straight away.
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(blob);
  try {
    // load/error events, not img.decode(): decode() can stall while the tab is not being painted.
    await new Promise((resolve, reject) => {
      dom.photo.onload = resolve;
      dom.photo.onerror = reject;
      dom.photo.src = state.objectUrl;
    });
  } catch {
    if (run !== state.run) return;
    setState("empty");
    return showAlert("That file could not be opened as an image.");
  }
  if (run !== state.run) return;
  setSize(dom.photo.naturalWidth, dom.photo.naturalHeight);
  dom.photo.alt = sample ? `Sample dashboard photo: ${sample.title}` : "Uploaded dashboard photo";

  dom.scanStatus.textContent = "Scanning for warning lights";
  dom.count.textContent = "Scanning the photo";
  setState("loading");
  const slow = setTimeout(() => {
    dom.scanStatus.textContent = "Still working. The first scan also loads the model";
  }, 3500);

  const started = performance.now();
  let payload;
  try {
    const response = await fetch("/predict", {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.json().then(
        (body) => (typeof body.detail === "string" ? body.detail : null),
        () => null,
      );
      throw new Error(detail ?? `The server answered with an error (${response.status}).`);
    }
    payload = await response.json();
  } catch (error) {
    clearTimeout(slow);
    if (error.name === "AbortError" || run !== state.run) return;
    setState("failed");
    const offline = error instanceof TypeError;
    return showAlert(
      offline ? "Could not reach the model server. Check that the app is still running, then try again." : error.message,
      { retry: true },
    );
  }
  clearTimeout(slow);

  const remaining = MIN_SCAN_MS - (performance.now() - started);
  if (remaining > 0 && !reducedMotion.matches) await sleep(remaining);
  if (run !== state.run) return;
  showResult(payload);
}

function reset() {
  state.run++;
  state.controller?.abort();
  state.blob = null;
  clearAlert();
  clearResult();
  markSample(null);
  setState("empty");
  dom.legend.open = true;
  dom.dropzone.focus();
}

function clearResult() {
  state.dets = [];
  state.hover = state.pinned = -1;
  for (const key of Object.keys(nodes)) nodes[key] = [];
  dom.overlay.replaceChildren();
  dom.overlay.classList.remove("has-active");
  dom.frame.classList.remove("has-active");
  dom.tags.replaceChildren();
  dom.list.replaceChildren();
  dom.emptyResult.hidden = true;
  dom.meta.replaceChildren();
  dimPath = leader = null;
  hideCard();
}

function setSize(w, h) {
  state.size = { w, h };
  dom.frame.style.setProperty("--ar", String(w / h));
  dom.overlay.setAttribute("viewBox", `0 0 ${w} ${h}`);
}

// ---- result -----------------------------------------------------------------------------------

function showResult(payload) {
  setSize(payload.image.width, payload.image.height);
  const unknown = { id: -1, short: "Unknown", name: "Unknown class", color: "#ffb224", meaning: "" };
  state.dets = payload.detections.map((d, i) => ({
    i,
    cls: state.classes?.byId.get(d.class_id) ?? { ...unknown, id: d.class_id, short: d.name, name: d.name },
    confidence: d.confidence,
    box: d.box,
  }));

  setState("result");
  buildOverlay();
  buildTags();
  buildList();
  applyThreshold();
  layout();

  dom.meta.replaceChildren(
    "Inference ",
    el("b", {}, `${payload.inference_ms} ms`),
    ` · ${payload.backend} · ${payload.image.width} × ${payload.image.height} px`,
  );
  dom.legend.open = false;
}

function cornersPath(x1, y1, x2, y2, c) {
  return (
    `M${x1} ${y1 + c}V${y1}H${x1 + c}` +
    `M${x2 - c} ${y1}H${x2}V${y1 + c}` +
    `M${x2} ${y2 - c}V${y2}H${x2 - c}` +
    `M${x1 + c} ${y2}H${x1}V${y2 - c}`
  );
}

function buildOverlay() {
  dimPath = svg("path", { class: "dim", "fill-rule": "evenodd" });
  leader = svg("line", { class: "leader" });
  const area = (d) => (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]);
  // Largest first, so a small light inside a bigger box stays on top and reachable.
  const groups = [...state.dets]
    .sort((a, b) => area(b) - area(a))
    .map((det) => {
      // Geometry is set in layout(), because it depends on the displayed size.
      const hit = svg("rect", { class: "det-hit" });
      const focus = svg("rect", { class: "det-focus" });
      const rect = svg("rect", { class: "det-box" });
      const corners = svg("path", { class: "det-corners" });
      const shape = svg("g", { class: "det-shape" }, rect, corners);
      const group = svg(
        "g",
        {
          class: "det is-new",
          tabindex: 0,
          role: "button",
          "aria-pressed": "false",
          "aria-label": `${det.cls.short}, ${pct(det.confidence)} confidence. ${det.cls.meaning}`,
        },
        hit,
        shape,
        focus,
      );
      group.style.setProperty("--c", det.cls.color);
      shape.addEventListener("animationend", () => group.classList.remove("is-new"), { once: true });
      bindDetection(group, det.i);
      nodes.boxes[det.i] = group;
      nodes.hits[det.i] = hit;
      nodes.focus[det.i] = focus;
      nodes.rects[det.i] = rect;
      nodes.corners[det.i] = corners;
      return group;
    });
  dom.overlay.replaceChildren(dimPath, ...groups, leader);
}

function buildTags() {
  dom.tags.replaceChildren(
    ...state.dets.map((det) => {
      const tag = el("span", { class: "tag" }, det.cls.short, el("b", {}, pct(det.confidence)));
      tag.style.setProperty("--c", det.cls.color);
      nodes.tags[det.i] = tag;
      return tag;
    }),
  );
}

function buildList() {
  dom.list.classList.add("is-arriving");
  dom.list.replaceChildren(
    ...state.dets.map((det) => {
      const row = el(
        "button",
        { type: "button", class: "det-row", "aria-pressed": "false", title: det.cls.name },
        classChip(det.cls),
        el("span", { class: "det-row-name" }, det.cls.short),
        el("span", { class: "det-row-pct" }, pct(det.confidence)),
        el("span", { class: "det-row-bar" }, el("i")),
      );
      row.style.setProperty("--c", det.cls.color);
      row.style.setProperty("--conf", String(det.confidence));
      bindDetection(row, det.i);
      const item = el("li", {}, el("div", {}, row));
      nodes.rows[det.i] = row;
      nodes.items[det.i] = item;
      return item;
    }),
  );
  // Two frames later the bars grow from zero to their confidence.
  requestAnimationFrame(() => requestAnimationFrame(() => dom.list.classList.remove("is-arriving")));
}

/** Hover, focus and click behave the same on an overlay box and on its list row. */
function bindDetection(node, i) {
  node.addEventListener("pointerenter", () => setHover(i));
  node.addEventListener("pointerleave", () => setHover(-1));
  node.addEventListener("focus", () => setHover(i));
  node.addEventListener("blur", () => setHover(-1));
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePin(i);
  });
  if (node instanceof SVGElement) {
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      togglePin(i);
    });
  }
}

function setHover(i) {
  if (state.hover === i) return;
  state.hover = i;
  renderActive();
}

function togglePin(i) {
  state.pinned = state.pinned === i ? -1 : i;
  renderActive();
}

// ---- threshold --------------------------------------------------------------------------------

function applyThreshold() {
  const t = state.threshold;
  let shown = 0;
  let rank = 0;
  for (const det of state.dets) {
    const off = det.confidence < t;
    if (!off) shown++;
    const box = nodes.boxes[det.i];
    box.classList.toggle("is-off", off);
    box.setAttribute("tabindex", off ? "-1" : "0");
    if (off) box.setAttribute("aria-hidden", "true");
    else box.removeAttribute("aria-hidden");
    box.style.setProperty("--i", String(off ? 0 : rank++));
    nodes.items[det.i].classList.toggle("is-off", off);
    nodes.items[det.i].inert = off;
    nodes.tags[det.i].classList.toggle("is-off", off);
  }
  if (state.pinned >= 0 && state.dets[state.pinned].confidence < t) state.pinned = -1;

  const label = t.toFixed(2);
  dom.thresholdOut.textContent = label;
  dom.threshold.style.setProperty("--p", `${((t - 0.1) / 0.8) * 100}%`);
  dom.threshold.setAttribute("aria-valuetext", `${label}, ${shown} ${shown === 1 ? "light" : "lights"} shown`);

  // While a scan is running the count line reads "Scanning the photo"; leave it alone then.
  if (dom.workspace.dataset.state === "result") {
    dom.count.textContent = shown
      ? `${shown} ${shown === 1 ? "light" : "lights"} at confidence ${label} or higher`
      : state.dets.length
        ? "No lights at this threshold"
        : "No lights found";
  }

  dom.emptyResult.hidden = shown > 0;
  if (!shown) {
    if (state.dets.length) {
      const best = state.dets[0].confidence;
      const target = Math.max(0.1, Math.floor(best * 100) / 100);
      dom.emptyText.textContent = `Nothing reaches ${label}. The strongest candidate scores ${best.toFixed(2)}, so try a lower threshold, or a closer photo of the cluster.`;
      dom.emptyAction.textContent = `Lower the threshold to ${target.toFixed(2)}`;
      dom.emptyAction.dataset.target = String(target);
      dom.emptyAction.hidden = false;
    } else {
      dom.emptyText.textContent =
        "No warning lights found in this photo. Try a closer, sharper shot of the instrument cluster with the lights lit.";
      dom.emptyAction.hidden = true;
    }
  }
  placeTags();
  renderActive();
}

// ---- highlight and label card -----------------------------------------------------------------

function activeDetection() {
  const i = state.hover >= 0 ? state.hover : state.pinned;
  const det = i >= 0 ? state.dets[i] : null;
  return det && det.confidence >= state.threshold ? det : null;
}

function renderActive() {
  const det = activeDetection();
  dom.overlay.classList.toggle("has-active", Boolean(det));
  dom.frame.classList.toggle("has-active", Boolean(det));
  state.dets.forEach(({ i }) => {
    const on = det?.i === i;
    const pinned = state.pinned === i;
    nodes.boxes[i].classList.toggle("is-active", on);
    nodes.boxes[i].setAttribute("aria-pressed", String(pinned));
    nodes.rows[i].classList.toggle("is-active", on);
    nodes.rows[i].classList.toggle("is-pinned", pinned);
    nodes.rows[i].setAttribute("aria-pressed", String(pinned));
    nodes.tags[i].classList.toggle("is-hidden", on);
  });
  if (!det) return hideCard();

  const { w, h } = state.size;
  const pad = (BOX_PAD_PX + 2) * unitsPerPixel();
  const [x1, y1, x2, y2] = det.box;
  dimPath?.setAttribute("d", `M0 0H${w}V${h}H0ZM${x1 - pad} ${y1 - pad}H${x2 + pad}V${y2 + pad}H${x1 - pad}Z`);
  showCard(det);
}

/** Image pixels per CSS pixel at the current display size. */
function unitsPerPixel() {
  return state.size.w / Math.max(1, dom.frame.clientWidth);
}

function showCard(det) {
  const changed = cardFor !== det.i;
  cardFor = det.i;
  if (changed) {
    const { cls } = det;
    dom.card.style.setProperty("--c", cls.color);
    dom.card.style.setProperty("--conf", String(det.confidence));
    dom.cardChip.style.setProperty("--c", cls.color);
    dom.cardChip.innerHTML = iconMarkup(cls.id); // static markup from icons.js
    dom.cardName.textContent = cls.short;
    const sameName = cls.name.toLowerCase() === cls.short.toLowerCase();
    dom.cardFull.textContent = sameName ? "" : cls.name;
    dom.cardFull.hidden = sameName;
    dom.cardMeaning.textContent = cls.meaning;
    dom.cardPct.textContent = pct(det.confidence);
    dom.card.classList.remove("is-in");
  }
  placeCard(det);
  if (changed) {
    void dom.card.offsetWidth; // flush styles so the entrance and the bar replay
    dom.card.classList.add("is-in");
    cancelPct();
    cancelPct = tween(480, (p) => {
      dom.cardPct.textContent = `${Math.round(det.confidence * 100 * p)}%`;
    });
  }
}

function hideCard() {
  cardFor = -1;
  dom.card.classList.remove("is-in");
  leader?.classList.remove("is-on");
}

/** Put the card beside the box, on whichever side has room, and keep it inside the image. */
function placeCard(det) {
  const fw = dom.frame.clientWidth;
  const fh = dom.frame.clientHeight;
  const sx = fw / state.size.w;
  const sy = fh / state.size.h;
  const box = {
    l: det.box[0] * sx - BOX_PAD_PX,
    t: det.box[1] * sy - BOX_PAD_PX,
    r: det.box[2] * sx + BOX_PAD_PX,
    b: det.box[3] * sy + BOX_PAD_PX,
  };
  const margin = 8;
  const gap = 16;

  // On a phone-sized photo the card narrows so more of the image stays visible.
  dom.card.style.maxWidth = `${Math.min(270, fw - 2 * margin, Math.max(200, fw * 0.7))}px`;
  const cw = dom.card.offsetWidth;
  const ch = dom.card.offsetHeight;
  const cx = (box.l + box.r) / 2;
  const cy = (box.t + box.b) / 2;

  const options = [
    { dx: -12, dy: 0, x: box.r + gap, y: cy - ch / 2, room: fw - margin - (box.r + gap + cw) },
    { dx: 12, dy: 0, x: box.l - gap - cw, y: cy - ch / 2, room: box.l - gap - cw - margin },
    { dx: 0, dy: -12, x: cx - cw / 2, y: box.b + gap, room: fh - margin - (box.b + gap + ch) },
    { dx: 0, dy: 12, x: cx - cw / 2, y: box.t - gap - ch, room: box.t - gap - ch - margin },
  ];
  const pick = options.find((o) => o.room >= 0) ?? options.reduce((a, b) => (b.room > a.room ? b : a));
  const x = clamp(pick.x, margin, Math.max(margin, fw - cw - margin));
  const y = clamp(pick.y, margin, Math.max(margin, fh - ch - margin));

  dom.card.style.left = `${x}px`;
  dom.card.style.top = `${y}px`;
  dom.card.style.setProperty("--dx", `${pick.dx}px`);
  dom.card.style.setProperty("--dy", `${pick.dy}px`);

  // Dotted leader from the box edge to the nearest point of the card, unless they overlap.
  if (!leader) return;
  const cardRect = { l: x, t: y, r: x + cw, b: y + ch };
  const overlaps = cardRect.l < box.r && cardRect.r > box.l && cardRect.t < box.b && cardRect.b > box.t;
  leader.classList.toggle("is-on", !overlaps);
  if (overlaps) return;
  const toX = clamp(cx, cardRect.l, cardRect.r);
  const toY = clamp(cy, cardRect.t, cardRect.b);
  const fromX = clamp(toX, box.l, box.r);
  const fromY = clamp(toY, box.t, box.b);
  leader.setAttribute("x1", fromX / sx);
  leader.setAttribute("y1", fromY / sy);
  leader.setAttribute("x2", toX / sx);
  leader.setAttribute("y2", toY / sy);
}

/** Everything that depends on the displayed size: hit areas, focus rings, tags, the card. */
function layout() {
  if (!state.dets.length) return;
  const u = unitsPerPixel();
  for (const det of state.dets) {
    const [x1, y1, x2, y2] = det.box;
    const w = x2 - x1;
    const h = y2 - y1;
    const g = BOX_PAD_PX * u;
    const side = Math.min(w, h) + 2 * g;
    setRect(nodes.rects[det.i], x1 - g, y1 - g, w + 2 * g, h + 2 * g, Math.min(side * 0.12, 5 * u));
    nodes.corners[det.i].setAttribute("d", cornersPath(x1 - g, y1 - g, x2 + g, y2 + g, side * 0.3));
    nodes.boxes[det.i].classList.toggle("is-tiny", side / u < TINY_PX);

    const px = Math.max((BOX_PAD_PX + 3) * u, (MIN_HIT_PX * u - w) / 2);
    const py = Math.max((BOX_PAD_PX + 3) * u, (MIN_HIT_PX * u - h) / 2);
    setRect(nodes.hits[det.i], x1 - px, y1 - py, w + 2 * px, h + 2 * py);
    setRect(nodes.focus[det.i], x1 - g - 4 * u, y1 - g - 4 * u, w + 2 * g + 8 * u, h + 2 * g + 8 * u, 4 * u);
  }
  placeTags();
  const det = activeDetection();
  if (det) renderActive();
}

/**
 * Place the always-on tags so they do not pile up where lights sit close together.
 * Strongest detection first; each tag takes the first spot around its box that is free.
 */
function placeTags() {
  const fw = dom.frame.clientWidth;
  const fh = dom.frame.clientHeight;
  const sx = fw / state.size.w;
  const sy = fh / state.size.h;
  const gap = 4;
  const shown = state.dets.filter((d) => d.confidence >= state.threshold);
  const boxes = shown.map((d) => ({
    i: d.i,
    l: d.box[0] * sx - BOX_PAD_PX,
    t: d.box[1] * sy - BOX_PAD_PX,
    r: d.box[2] * sx + BOX_PAD_PX,
    b: d.box[3] * sy + BOX_PAD_PX,
  }));
  const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const placed = [];

  for (const box of boxes) {
    const tag = nodes.tags[box.i];
    const w = tag.offsetWidth;
    const h = tag.offsetHeight;
    const midY = (box.t + box.b) / 2 - h / 2;
    const spots = [
      [box.l, box.t - h - gap],
      [box.l, box.b + gap],
      [box.r - w, box.t - h - gap],
      [box.r - w, box.b + gap],
      [box.r + gap, midY],
      [box.l - w - gap, midY],
      [box.l, box.t - 2 * h - 2 * gap],
      [box.l, box.b + h + 2 * gap],
      [box.r + gap, box.t - h],
      [box.l - w - gap, box.b],
    ]
      .filter(([x, y]) => x >= 2 && y >= 2 && x + w <= fw - 2 && y + h <= fh - 2)
      .map(([x, y]) => ({ l: x, t: y, r: x + w, b: y + h }));
    const others = boxes.filter((b) => b.i !== box.i);
    const pick =
      spots.find((s) => !placed.some((p) => hits(s, p)) && !others.some((b) => hits(s, b))) ??
      spots.find((s) => !placed.some((p) => hits(s, p))) ??
      spots[0] ?? { l: clamp(box.l, 2, Math.max(2, fw - w - 2)), t: clamp(box.t - h - gap, 2, Math.max(2, fh - h - 2)) };
    placed.push({ ...pick, r: pick.l + w, b: pick.t + h });
    tag.style.left = `${pick.l}px`;
    tag.style.top = `${pick.t}px`;
  }
}

function setRect(rect, x, y, width, height, rx = 0) {
  rect.setAttribute("x", x);
  rect.setAttribute("y", y);
  rect.setAttribute("width", width);
  rect.setAttribute("height", height);
  if (rx) rect.setAttribute("rx", rx);
}

// ---- samples, legend --------------------------------------------------------------------------

function markSample(sample) {
  for (const button of dom.samples.children) {
    button.classList.toggle("is-current", Boolean(sample) && button.dataset.file === sample.file);
  }
}

function buildSamples(samples) {
  dom.samples.replaceChildren(
    ...samples.map((sample) =>
      el(
        "button",
        {
          type: "button",
          class: "sample",
          "data-file": sample.file,
          onclick: async () => {
            try {
              const response = await fetch(`/static/samples/${sample.file}`);
              if (!response.ok) throw new Error(String(response.status));
              analyse(await response.blob(), { sample });
              dom.stage.scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
            } catch {
              showAlert("That sample photo could not be loaded.");
            }
          },
        },
        el(
          "span",
          { class: "sample-thumb" },
          el("img", { src: `/static/samples/${sample.file}`, alt: "", loading: "lazy", width: sample.width, height: sample.height }),
        ),
        el("span", { class: "sample-title" }, sample.title),
      ),
    ),
  );
}

function buildLegend(classes) {
  dom.legendList.replaceChildren(
    ...classes.list.map((cls) => el("li", {}, classChip(cls), el("strong", {}, cls.short), el("span", {}, cls.meaning))),
  );
  dom.disclaimer.textContent = classes.disclaimer;
}

// ---- wiring -----------------------------------------------------------------------------------

function wire() {
  dom.dropzone.addEventListener("click", () => dom.file.click());
  dom.file.addEventListener("change", () => {
    const [file] = dom.file.files;
    dom.file.value = "";
    if (file) analyse(file);
  });
  dom.another.addEventListener("click", reset);
  dom.alertRetry.addEventListener("click", () => state.blob && analyse(state.blob));

  dom.threshold.addEventListener("input", () => {
    state.threshold = Number(dom.threshold.value);
    applyThreshold();
  });
  dom.emptyAction.addEventListener("click", () => {
    dom.threshold.value = dom.emptyAction.dataset.target;
    state.threshold = Number(dom.threshold.value);
    applyThreshold();
    dom.threshold.focus();
  });
  dom.labels.addEventListener("change", () => dom.frame.classList.toggle("show-tags", dom.labels.checked));

  // A click on the photo itself, away from any box, releases a pinned light.
  dom.frame.addEventListener("click", () => {
    if (state.pinned < 0) return;
    state.pinned = -1;
    renderActive();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || (state.pinned < 0 && state.hover < 0)) return;
    state.pinned = state.hover = -1;
    renderActive();
  });

  // Drop anywhere on the page; paste from the clipboard.
  const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  let depth = 0;
  window.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    depth++;
    dom.stage.classList.add("is-dragging");
  });
  window.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) dom.stage.classList.remove("is-dragging");
  });
  window.addEventListener("dragover", (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    dom.stage.classList.remove("is-dragging");
    const files = Array.from(event.dataTransfer.files);
    const file = files.find((f) => f.type.startsWith("image/")) ?? files[0];
    if (file) analyse(file);
  });
  window.addEventListener("paste", (event) => {
    const item = Array.from(event.clipboardData?.items ?? []).find((i) => i.kind === "file" && i.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (!file) return;
    event.preventDefault();
    analyse(file);
  });

  new ResizeObserver(layout).observe(dom.frame);
}

async function start() {
  wire();
  dom.threshold.style.setProperty("--p", `${((state.threshold - 0.1) / 0.8) * 100}%`);
  for (const node of document.querySelectorAll("[data-reveal]")) node.classList.add("is-in");
  // The sample photos are optional: a fresh clone has none until tools/copy_samples.py is run.
  const samplesReady = loadJSON("/static/samples/samples.json").catch(() => []);
  try {
    state.classes = await loadClasses();
    buildLegend(state.classes);
  } catch (error) {
    console.error(error);
    showAlert("The page data could not be loaded. Reload the page to try again.");
  }
  const samples = await samplesReady;
  dom.samples.closest(".samples").hidden = samples.length === 0;
  buildSamples(samples);
}

start();
