// Hand-drawn telltale symbols, one per model class id. 32x32, stroked in currentColor.
// These strings are static markup written here, never user data, so innerHTML is safe for them.

const EXCLAIM = '<path d="M16 10.8v6.4"/><circle cx="16" cy="20.6" r="1.25" fill="currentColor" stroke="none"/>';
const BRAKE_RING =
  '<circle cx="16" cy="16" r="7.6"/><path d="M6.6 8.4a12.4 12.4 0 0 0 0 15.2M25.4 8.4a12.4 12.4 0 0 1 0 15.2"/>';

const GLYPHS = {
  // ABS: ring with brake-shoe arcs and the letters
  0: `${BRAKE_RING}<text x="16" y="18.3" text-anchor="middle" font-family="Barlow, sans-serif" font-size="6.6" font-weight="600" letter-spacing="0.2" fill="currentColor" stroke="none">ABS</text>`,
  // Brake: the same ring with an exclamation mark
  1: `${BRAKE_RING}${EXCLAIM}`,
  // Charging: battery with terminals, minus and plus
  2: '<rect x="4.5" y="10.5" width="23" height="14" rx="2"/><path d="M8.5 10.5v-3h4.5v3M19 10.5v-3h4.5v3M8.6 17.5h4.4M19.1 17.5h4.4M21.3 15.3v4.4"/>',
  // Check engine: engine block outline
  3: '<path d="M9.5 12H20l2.2 3H25v-2h2.3v9.5H25v-2h-2.8v3H13.3l-3.1-3H8.2V15h1.3z"/><path d="M11.5 8.5h8M15.5 8.5V12M4.8 13.8v8M4.8 17.8h3.4"/>',
  // ESP: car above two skid marks
  4: '<path d="M10 14l1.5-4a1.6 1.6 0 0 1 1.5-1h6a1.6 1.6 0 0 1 1.5 1l1.5 4"/><rect x="7" y="14" width="18" height="5.6" rx="1.6"/><path d="M10.4 19.6v2M21.6 19.6v2M11.6 23.4c-2.4 1.3 2.4 2.5 0 3.8M20.4 23.4c-2.4 1.3 2.4 2.5 0 3.8"/>',
  // Overheating: thermometer standing in coolant
  5: '<path d="M16 5v12.6M16 8h4.2M16 12h4.2"/><circle cx="16" cy="20.2" r="2.7" fill="currentColor" stroke="none"/><path d="M4.5 21.4c1.6-1.3 3.2 1.3 4.8 0M22.7 21.4c1.6-1.3 3.2 1.3 4.8 0M4.5 26c1.9-1.5 3.8 1.5 5.75 0s3.8 1.5 5.75 0 3.8 1.5 5.75 0 3.8 1.5 5.75 0"/>',
  // Oil: oil can with a drop at the spout
  6: '<path d="M9 14.5h8.6l2.6 2.6 7.2-3.6-6.4 8H9z"/><path d="M12.4 14.5v-2.6M10.6 11.9h3.6M9 16.6l-4.4-1.5v3.5"/><path d="M27.6 17.2c.9 1.3 1.4 2.1 1.4 2.9a1.4 1.4 0 0 1-2.8 0c0-.8.5-1.6 1.4-2.9z" fill="currentColor" stroke="none"/>',
  // Tyre pressure: tyre cross-section with tread and an exclamation mark
  7: `<path d="M11.4 5.2C5.6 8.6 4.8 18 9.6 23.6h12.8c4.8-5.6 4-15-1.8-18.4"/><path d="M10 27v-3.4M14 27v-3.4M18 27v-3.4M22 27v-3.4"/><path d="M16 9.6v6.4"/><circle cx="16" cy="19.4" r="1.25" fill="currentColor" stroke="none"/>`,
  // Master warning: triangle with an exclamation mark
  8: '<path d="M16 5.2 27.6 25.6H4.4z"/><path d="M16 12.4v6.2"/><circle cx="16" cy="21.8" r="1.25" fill="currentColor" stroke="none"/>',
  // Airbag: seated passenger with the inflated bag in front
  9: '<circle cx="20.5" cy="7.8" r="2.6"/><circle cx="10.5" cy="13.8" r="4.7"/><path d="M20.8 12.4l-3 9.2h-6.6l-2 5M25 12.6l-3.2 12.2H26"/>',
};

/** SVG markup for a class symbol. */
export function iconMarkup(classId) {
  const glyph = GLYPHS[classId] ?? GLYPHS[8];
  return `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${glyph}</svg>`;
}

/** A coloured chip element holding the class symbol. */
export function classChip(cls, { small = false } = {}) {
  const chip = document.createElement("span");
  chip.className = small ? "chip is-small" : "chip";
  chip.style.setProperty("--c", cls.color);
  chip.innerHTML = iconMarkup(cls.id);
  return chip;
}
