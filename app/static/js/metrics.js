// Metrics page. Every number shown here is read from /static/data/metrics.json.

import { createRevealer, el, loadClasses, loadJSON, parseDisplay, reducedMotion, svg, tween, withUnit } from "./common.js";
import { classChip, iconMarkup } from "./icons.js";

window.__appStarted = true;

const $ = (id) => document.getElementById(id);
const revealer = createRevealer();

const arrows = (text) => text.replaceAll("->", "→");
/** "83.9%" -> 0.839, "0.914" -> 0.914 */
const fraction = (display) => {
  const { value, suffix } = parseDisplay(display);
  return suffix.trim() === "%" ? value / 100 : value;
};
const stagger = (node, index, step = 70) => node.style.setProperty("--bar-delay", `${index * step}ms`);

function cardTitle(title, sub) {
  return el("div", { class: "card-title" }, el("h3", {}, title), sub ? el("p", {}, sub) : null);
}

// ---- hero -------------------------------------------------------------------------------------

function renderHero(metrics, classes) {
  $("hero-eyebrow").textContent = metrics.model.eyebrow;
  $("hero-summary").textContent = metrics.model.summary;
  $("evaluation-text").textContent = metrics.model.evaluation;
  $("footer-note").textContent = metrics.limitations.at(-1);
  $("model-facts").replaceChildren(
    ...metrics.model.facts.map((fact) => el("div", {}, el("dt", {}, fact.label), el("dd", {}, fact.value))),
  );

  const lamps = classes.list.map((cls) => {
    const lamp = el("span", { class: "telltale-lamp" });
    lamp.innerHTML = iconMarkup(cls.id); // static markup from icons.js
    const item = el("li", { class: "telltale", title: cls.meaning }, lamp, el("span", { class: "telltale-name" }, cls.short));
    item.style.setProperty("--c", cls.color);
    return item;
  });
  $("telltales").replaceChildren(...lamps);

  // Bulb check: the lamps come on one after another, as a cluster does at ignition.
  lamps.forEach((lamp, i) => {
    if (reducedMotion.matches) lamp.classList.add("is-lit");
    else setTimeout(() => lamp.classList.add("is-lit"), 450 + i * 110);
  });
}

// ---- headline gauges --------------------------------------------------------------------------

const GAUGE = { cx: 110, cy: 104, r: 82, start: 135, sweep: 270, steps: 40 };

function gaugePoint(t, radius) {
  const angle = ((GAUGE.start + GAUGE.sweep * t) * Math.PI) / 180;
  return [GAUGE.cx + radius * Math.cos(angle), GAUGE.cy + radius * Math.sin(angle)];
}

function gaugeFrame({ endLabels, dial = false }) {
  const { r, steps } = GAUGE;
  const [sx, sy] = gaugePoint(0, r);
  const [ex, ey] = gaugePoint(1, r);
  const arc = `M${sx.toFixed(2)} ${sy.toFixed(2)}A${r} ${r} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  const ticks = Array.from({ length: steps + 1 }, (_, i) => {
    const major = i % 10 === 0;
    const [x1, y1] = gaugePoint(i / steps, r + 10);
    const [x2, y2] = gaugePoint(i / steps, r + (major ? 18 : 14));
    return svg("line", { class: major ? "gauge-tick is-major" : "gauge-tick", x1, y1, x2, y2 });
  });
  const value = svg("path", { class: "gauge-value", d: arc, pathLength: 1000, "stroke-dasharray": "0 1000" });
  const cap = svg("circle", { class: "gauge-cap", r: 3.2, cx: sx, cy: sy });
  // A plain dial (the odometer tile) has the ring and ticks but no value arc.
  const frame = svg(
    "svg",
    { viewBox: "0 0 220 184", "aria-hidden": "true", focusable: "false" },
    ...ticks,
    svg("path", { class: "gauge-track", d: arc }),
    ...(dial ? [] : [value, cap]),
  );
  if (endLabels) {
    const [lx, ly] = gaugePoint(0, r);
    const [rx, ry] = gaugePoint(1, r);
    const left = svg("text", { class: "gauge-end", x: lx + 2, y: ly + 20, "text-anchor": "middle" });
    left.textContent = endLabels[0];
    const right = svg("text", { class: "gauge-end", x: rx - 2, y: ry + 20, "text-anchor": "middle" });
    right.textContent = endLabels[1];
    frame.append(left, right);
  }
  return { frame, ticks, value, cap };
}

function gaugeTile(item, index) {
  const parsed = parseDisplay(item.value);
  const isPercent = parsed.suffix.trim() === "%";
  const target = parsed.value / item.max;
  const { frame, ticks, value, cap } = gaugeFrame({ endLabels: ["0", isPercent ? "100" : String(item.max)] });

  const num = el("span", { class: "num" }, (0).toFixed(parsed.decimals));
  const readout = el("div", { class: "gauge-readout" }, num, parsed.suffix ? el("span", { class: "unit" }, parsed.suffix) : null);
  const tile = el(
    "article",
    { class: "gauge-tile panel", "data-reveal": true, "aria-label": `${item.label}: ${item.value}. ${item.context}. ${item.secondary}.` },
    el("p", { class: "tile-context" }, item.context),
    el("div", { class: "gauge" }, frame, readout),
    el("h3", { class: "tile-label" }, item.label),
    el("p", { class: "tile-secondary" }, item.secondary),
  );
  tile.style.setProperty("--reveal-delay", `${index * 90}ms`);

  const draw = (p) => {
    const t = Math.max(0, target * p);
    value.setAttribute("stroke-dasharray", `${(t * 1000).toFixed(1)} 1000`);
    const [x, y] = gaugePoint(Math.min(t, 1), GAUGE.r);
    cap.setAttribute("cx", x);
    cap.setAttribute("cy", y);
    ticks.forEach((tick, i) => tick.classList.toggle("is-on", i / GAUGE.steps <= t + 1e-6));
    // Land on the exact string from the data file.
    num.textContent = p >= 1 ? parsed.number : (parsed.value * Math.min(p, 1)).toFixed(parsed.decimals);
  };
  draw(0);
  revealer.watch(tile, () => tween(1500, draw, { delay: 250 + index * 90, ease: settle }));
  return tile;
}

/** Ease out with a small overshoot, like a needle settling. Ends exactly at 1. */
function settle(t) {
  const c = 1.1;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function odometerTile(item, index) {
  const { frame } = gaugeFrame({ endLabels: null, dial: true });
  const digits = [...item.value];
  const strips = digits.map((digit, i) => {
    const strip = el("span", { class: "drum-strip" }, ...Array.from({ length: 10 }, (_, n) => el("span", {}, n)));
    strip.style.setProperty("--drum-delay", `${(digits.length - 1 - i) * 140}ms`);
    return { strip, digit: Number(digit) };
  });
  const tile = el(
    "article",
    { class: "gauge-tile panel", "data-reveal": true, "aria-label": `${item.label}: ${item.value}. ${item.context}. ${item.secondary}.` },
    el("p", { class: "tile-context" }, item.context),
    el("div", { class: "gauge" }, frame, el("div", { class: "odometer", "aria-hidden": "true" }, ...strips.map(({ strip }) => el("span", { class: "drum" }, strip)))),
    el("h3", { class: "tile-label" }, item.label),
    el("p", { class: "tile-secondary" }, item.secondary),
  );
  tile.style.setProperty("--reveal-delay", `${index * 90}ms`);
  revealer.watch(tile, () => {
    setTimeout(
      () => strips.forEach(({ strip, digit }) => (strip.style.transform = `translateY(-${digit * 10}%)`)),
      reducedMotion.matches ? 0 : 300 + index * 90,
    );
  });
  return tile;
}

function renderHeadline(metrics) {
  // One gradient shared by every gauge arc.
  const gradient = svg(
    "linearGradient",
    { id: "gauge-gradient", gradientUnits: "userSpaceOnUse", x1: 20, y1: 160, x2: 200, y2: 60 },
    svg("stop", { offset: 0, "stop-color": "#b96a00" }),
    svg("stop", { offset: 0.55, "stop-color": "#ffb224" }),
    svg("stop", { offset: 1, "stop-color": "#ffd77a" }),
  );
  document.body.append(svg("svg", { width: 0, height: 0, "aria-hidden": "true", style: "position:absolute" }, svg("defs", {}, gradient)));

  $("headline").replaceChildren(
    ...metrics.headline.map((item, i) => (item.kind === "odometer" ? odometerTile(item, i) : gaugeTile(item, i))),
  );
}

// ---- result tables ----------------------------------------------------------------------------

function dataTable(columns, rows) {
  return el(
    "div",
    { class: "table-scroll" },
    el(
      "table",
      { class: "data" },
      el("thead", {}, el("tr", {}, ...columns.map((c) => el("th", { scope: "col" }, c.label)))),
      el(
        "tbody",
        {},
        ...rows.map((row) =>
          el(
            "tr",
            {},
            ...columns.map((c, i) =>
              i === 0
                ? el("th", { scope: "row" }, row.set, el("small", {}, row.images))
                : el("td", { class: c.strong ? "is-strong" : null }, row[c.key]),
            ),
          ),
        ),
      ),
    ),
  );
}

function renderTables(metrics) {
  const at040 = metrics.at_confidence_040;
  $("table-040").replaceChildren(
    cardTitle(at040.title),
    dataTable(
      [
        { label: "Set" },
        { label: "Objects", key: "objects" },
        { label: "Precision", key: "precision", strong: true },
        { label: "Recall", key: "recall", strong: true },
      ],
      at040.rows,
    ),
  );

  const free = metrics.threshold_free;
  $("table-free").replaceChildren(
    cardTitle(free.title, free.subtitle),
    dataTable(
      [
        { label: "Set" },
        { label: "Precision", key: "precision" },
        { label: "Recall", key: "recall" },
        { label: "mAP@50", key: "map50", strong: true },
        { label: "mAP@50-95", key: "map5095", strong: true },
      ],
      free.rows,
    ),
    el("p", { class: "card-note" }, free.note),
  );
}

// ---- R2 vs R4 ---------------------------------------------------------------------------------

function seriesLegend(series) {
  return el(
    "div",
    { class: "legend-row" },
    ...series.map((s) => el("span", {}, el("i", { style: { "--k": s.key === "r2" ? "var(--cool-fill)" : "var(--amber-fill)" } }), s.label)),
  );
}

function renderCompare(metrics) {
  const data = metrics.r2_vs_r4;
  const measures = [
    { key: "precision", label: "Precision" },
    { key: "recall", label: "Recall" },
  ];
  const slots = []; // { set, measure, series, slot, label }

  const panels = data.by_confidence[0].sets.map((set, s) => {
    const groups = measures.map((measure, m) =>
      el(
        "div",
        { class: "plot-group" },
        ...data.series.map((series, k) => {
          const label = el("span", { class: "bar-value" });
          const slot = el("div", { class: `bar-slot is-${series.key}` }, el("div", { class: "bar" }), label);
          stagger(slot, s * 4 + m * 2 + k, 80);
          slots.push({ set: set.set, measure: measure.key, series: series.key, slot, label });
          return slot;
        }),
      ),
    );
    return el(
      "div",
      { class: "col-panel" },
      el("h4", {}, set.set),
      el(
        "div",
        { class: "plot" },
        el(
          "div",
          { class: "plot-grid", "aria-hidden": "true" },
          ...[0, 25, 50, 75, 100].map((tick) => el("span", { style: { "--y": tick / 100 } }, el("b", {}, `${tick}%`))),
        ),
        el("div", { class: "plot-groups" }, ...groups),
      ),
      el("div", { class: "plot-x" }, ...measures.map((m) => el("span", {}, m.label))),
    );
  });

  const show = (confidence) => {
    const block = data.by_confidence.find((b) => b.confidence === confidence);
    for (const item of slots) {
      const display = block.sets.find((s) => s.set === item.set)[item.measure][item.series];
      item.slot.style.setProperty("--v", String(fraction(display)));
      item.label.textContent = display;
    }
  };

  const picker = el(
    "div",
    { class: "segmented", role: "radiogroup", "aria-label": "Confidence threshold" },
    ...data.by_confidence.map((block) =>
      el(
        "label",
        {},
        el("input", {
          type: "radio",
          name: "compare-confidence",
          value: block.confidence,
          checked: block.confidence === data.default_confidence,
          onchange: (event) => show(event.target.value),
        }),
        el("span", {}, block.confidence),
      ),
    ),
  );

  $("compare-chart").replaceChildren(
    cardTitle("Precision and recall"),
    el("div", { class: "chart-tools" }, seriesLegend(data.series), el("div", { class: "tool" }, "Confidence", picker)),
    el("div", { class: "col-panels" }, ...panels),
  );
  show(data.default_confidence);
}

function renderObjectLevel(metrics) {
  const data = metrics.object_level;
  const arrow = (up) =>
    svg(
      "svg",
      { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2.4, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
      svg("path", { d: up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6" }),
    );
  $("object-level").replaceChildren(
    cardTitle("Light by light", data.basis),
    el(
      "div",
      { class: "changes" },
      ...data.rows.map((row) => {
        const up = parseDisplay(row.r4).value > parseDisplay(row.r2).value;
        return el(
          "div",
          { class: "change" },
          el("span", { class: "change-label" }, row.label),
          el("span", { class: "change-now" }, el("span", {}, ...withUnit(row.r4)), arrow(up)),
          el("span", { class: "change-was" }, `R2: ${row.r2}`),
        );
      }),
    ),
    el("p", { class: "card-note" }, data.note),
  );
}

// ---- journey ----------------------------------------------------------------------------------

const KIND_LABEL = {
  reference: "Published reference",
  model: "Model",
  dropped: "Dropped experiment",
  data: "Data work",
  final: "Final model",
};

function renderJourney(metrics) {
  $("timeline").replaceChildren(
    ...metrics.journey.map((stage, i) =>
      el(
        "li",
        { class: "stage", "data-kind": stage.kind, "data-reveal": true },
        el("span", { class: "stage-node", "aria-hidden": "true" }, String(i + 1).padStart(2, "0")),
        el(
          "article",
          { class: "stage-card panel" },
          el(
            "div",
            {},
            el("div", { class: "stage-head" }, el("h3", {}, stage.stage), el("span", { class: "stage-tag" }, KIND_LABEL[stage.kind] ?? stage.kind)),
            el(
              "dl",
              { class: "stage-facts" },
              el("div", {}, el("dt", {}, "Change"), el("dd", {}, stage.done)),
              el("div", {}, el("dt", {}, "Result"), el("dd", {}, arrows(stage.result))),
              el("div", { class: "is-lesson" }, el("dt", {}, "Lesson"), el("dd", {}, stage.lesson)),
            ),
          ),
          el("div", { class: "stage-key" }, el("b", {}, ...withUnit(stage.key.value)), el("span", {}, stage.key.caption)),
        ),
      ),
    ),
  );
}

// ---- per class --------------------------------------------------------------------------------

function classCell(cls) {
  return el("th", { scope: "row" }, el("span", { class: "class-cell", title: cls.name }, classChip(cls, { small: true }), cls.short));
}

function renderPerClass(metrics, classes) {
  const data = metrics.per_class_test;
  const columns = [
    { key: "precision", label: "Precision" },
    { key: "recall", label: "Recall" },
    { key: "ap50", label: "AP@50" },
  ];
  $("per-class").replaceChildren(
    cardTitle(data.title),
    el(
      "table",
      { class: "bars" },
      el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Class"), ...columns.map((c) => el("th", { scope: "col" }, c.label)))),
      el(
        "tbody",
        {},
        ...data.rows.map((row, r) =>
          el(
            "tr",
            {},
            classCell(classes.byId.get(row.class_id)),
            ...columns.map((c, k) => {
              const meter = el("span", { class: "meter", style: { "--v": fraction(row[c.key]) } }, el("b", {}, row[c.key]), el("i"));
              stagger(meter, r + k * 2, 45);
              return el("td", {}, meter);
            }),
          ),
        ),
      ),
    ),
  );
}

function renderOutcomes(metrics, classes) {
  const data = metrics.outcomes;
  const kinds = [
    { key: "correct", label: "Correct", css: "k-correct" },
    { key: "wrong_class", label: "Wrong class", css: "k-wrong" },
    { key: "missed", label: "Missed", css: "k-missed" },
  ];
  const total = (row) => kinds.reduce((sum, k) => sum + Number(row[k.key]), 0);
  const longest = Math.max(...data.rows.map(total)); // bar length only; no derived number is displayed

  $("outcomes").replaceChildren(
    cardTitle(data.title, data.basis),
    el("div", { class: "legend-row", style: { "margin-bottom": "14px" } }, ...kinds.map((k) => el("span", {}, el("i", { class: k.css }), k.label))),
    el(
      "table",
      { class: "bars" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { scope: "col" }, "Class"),
          el("th", { scope: "col" }, el("span", { class: "sr-only" }, "Share of lights")),
          ...kinds.map((k) => el("th", { scope: "col", class: "num" }, k.label)),
        ),
      ),
      el(
        "tbody",
        {},
        ...data.rows.map((row, r) => {
          const stack = el(
            "div",
            { class: "stack", style: { "--share": total(row) / longest }, "aria-hidden": "true" },
            ...kinds.filter((k) => Number(row[k.key]) > 0).map((k) => el("i", { class: k.css, style: { "--n": row[k.key] } })),
          );
          stagger(stack, r, 45);
          return el(
            "tr",
            {},
            classCell(classes.byId.get(row.class_id)),
            el("td", { class: "stack-cell" }, stack),
            ...kinds.map((k) => el("td", { class: row[k.key] === "0" ? "num is-zero" : "num" }, row[k.key])),
          );
        }),
      ),
    ),
  );
}

// ---- size and training ------------------------------------------------------------------------

function renderBySize(metrics) {
  const data = metrics.by_size;
  const share = (cell) => cell.fraction ?? cell.found / cell.of;
  $("by-size").replaceChildren(
    cardTitle(data.title, data.basis),
    seriesLegend(metrics.r2_vs_r4.series),
    el(
      "div",
      { class: "size-rows", style: { "margin-top": "20px" } },
      ...data.rows.map((row, r) =>
        el(
          "div",
          { class: "size-row" },
          el("h4", {}, row.size, el("small", {}, `${row.objects} objects`)),
          el(
            "div",
            { class: "hbars" },
            ...["r2", "r4"].map((key, k) => {
              const fill = el("span", { class: "hbar-fill" });
              stagger(fill, r * 2 + k, 70);
              return el(
                "div",
                { class: `hbar is-${key}`, style: { "--v": share(row[key]) }, "aria-label": `${key.toUpperCase()}: ${row[key].display}` },
                fill,
                el("b", {}, row[key].display),
              );
            }),
          ),
        ),
      ),
    ),
  );
}

function renderTraining(metrics) {
  const data = metrics.training;
  $("training").replaceChildren(
    cardTitle(data.title),
    el(
      "dl",
      { class: "facts" },
      ...data.facts.map((fact) =>
        el("div", {}, el("dt", {}, fact.label), el("dd", {}, fact.value, fact.detail ? el("small", {}, fact.detail) : null)),
      ),
    ),
  );
}

// ---- limitations ------------------------------------------------------------------------------

function renderLimitations(metrics) {
  const icon = () =>
    svg(
      "svg",
      { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" },
      svg("path", { d: "M12 4 21.5 20h-19z" }),
      svg("path", { d: "M12 10v4.5M12 17.3v.2" }),
    );
  $("limits").replaceChildren(
    ...metrics.limitations.map((text, i) => {
      const item = el("li", { "data-reveal": true }, icon(), el("p", {}, text));
      item.style.setProperty("--reveal-delay", `${(i % 2) * 80}ms`);
      return item;
    }),
  );
}

// ---- start ------------------------------------------------------------------------------------

async function start() {
  try {
    const [metrics, classes] = await Promise.all([loadJSON("/static/data/metrics.json"), loadClasses()]);
    renderHero(metrics, classes);
    renderHeadline(metrics);
    renderTables(metrics);
    renderCompare(metrics);
    renderObjectLevel(metrics);
    renderJourney(metrics);
    renderPerClass(metrics, classes);
    renderOutcomes(metrics, classes);
    renderBySize(metrics);
    renderTraining(metrics);
    renderLimitations(metrics);
  } catch (error) {
    console.error(error);
    document.documentElement.classList.remove("js");
    $("hero-summary").textContent = "The metrics data could not be loaded. Reload the page to try again.";
  }
  revealer.scan();
  // The sections were empty when the browser first resolved a #hash, so go there again once the
  // content is in and the web fonts have settled the layout.
  if (location.hash.length > 1) {
    await Promise.race([document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 1500))]);
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
}

start();
