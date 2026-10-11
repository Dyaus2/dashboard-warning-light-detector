// Shared helpers for both pages: data loading, element building, motion utilities.

// Motion is off when the system asks for reduced motion, or when the page is opened with
// ?motion=off (handy for screenshots and printing). The inline script in <head> sets .no-motion.
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = {
  get matches() {
    return motionQuery.matches || document.documentElement.classList.contains("no-motion");
  },
};

export async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

/** Classes keyed by id, from classes.json. */
export async function loadClasses() {
  const data = await loadJSON("/static/data/classes.json");
  return { byId: new Map(data.classes.map((c) => [c.id, c])), list: data.classes, disclaimer: data.disclaimer };
}

/**
 * el("div", { class: "x", "data-id": 3 }, "text", childNode, ...)
 * Strings become text nodes, so data is never parsed as HTML.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop, v);
    } else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

/**
 * Split "85.3%" or "0.821" or "145" into a number, its decimals and its suffix.
 * `number` keeps the digits exactly as written ("0.880" stays "0.880").
 */
export function parseDisplay(text) {
  const match = /^(-?\d+(?:\.(\d+))?)(.*)$/.exec(String(text).trim());
  if (!match) return { value: NaN, number: String(text), decimals: 0, suffix: "", text: String(text) };
  return {
    value: Number(match[1]),
    number: match[1],
    decimals: match[2] ? match[2].length : 0,
    suffix: match[3],
    text: String(text),
  };
}

/** "85.3%" as nodes: the digits, then the unit in its own span so it can use the body face. */
export function withUnit(display) {
  const { number, suffix, value } = parseDisplay(display);
  if (Number.isNaN(value) || !suffix) return [String(display)];
  return [number, el("span", { class: "unit" }, suffix)];
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeOutBack = (t) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

/** Run fn(progress 0..1) over `duration` ms. Jumps to the end when motion is reduced. */
export function tween(duration, fn, { delay = 0, ease = easeOutCubic } = {}) {
  if (reducedMotion.matches || duration <= 0) {
    fn(1);
    return () => {};
  }
  let raf = 0;
  let cancelled = false;
  const start = performance.now() + delay;
  const step = (now) => {
    if (cancelled) return;
    const t = clamp((now - start) / duration, 0, 1);
    fn(t <= 0 ? 0 : ease(t));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  fn(0);
  raf = requestAnimationFrame(step);
  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
  };
}

/** Count a text node up to its final display string, landing on the exact string given. */
export function countUp(node, display, { duration = 1100, delay = 0, from = 0 } = {}) {
  const parsed = parseDisplay(display);
  if (Number.isNaN(parsed.value)) {
    node.textContent = display;
    return;
  }
  tween(
    duration,
    (p) => {
      node.textContent = p >= 1 ? parsed.text : (from + (parsed.value - from) * p).toFixed(parsed.decimals) + parsed.suffix;
    },
    { delay },
  );
}

/**
 * Reveal [data-reveal] elements as they scroll into view, and call `onEnter(element)` once
 * for elements registered with watch().
 */
export function createRevealer() {
  const callbacks = new WeakMap();
  const enter = (target) => {
    target.classList.add("is-in");
    callbacks.get(target)?.(target);
    callbacks.delete(target);
  };
  // With motion off there is nothing to stage, so everything is entered straight away.
  const observer =
    "IntersectionObserver" in window && !reducedMotion.matches
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              observer.unobserve(entry.target);
              enter(entry.target);
            }
          },
          { threshold: 0.18, rootMargin: "0px 0px -6% 0px" },
        )
      : null;
  return {
    scan(root = document) {
      for (const node of root.querySelectorAll("[data-reveal]:not(.is-in)")) observer ? observer.observe(node) : enter(node);
    },
    watch(node, onEnter) {
      callbacks.set(node, onEnter);
      observer ? observer.observe(node) : enter(node);
    },
  };
}

document.documentElement.classList.add("js");
