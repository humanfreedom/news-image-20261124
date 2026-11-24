// news-image-20261124 — "The World in One Day"
// A code-drawn newspaper front page summing up Tuesday 24 November 2026.
// 100% original: own PNG encoder, own bit-packed 5x7 bitmap font, own layout.
// Deterministic: no clock, no randomness, no network. Stdlib only.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// =============================================================== PNG =====
// CRC-32 (IEEE, reflected polynomial 0xEDB88320), table built once.
const CRC: Uint32Array = (() => {
  const tab = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tab[i] = c >>> 0;
  }
  return tab;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function be32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (n >>> 24) & 0xff;
  b[1] = (n >>> 16) & 0xff;
  b[2] = (n >>> 8) & 0xff;
  b[3] = n & 0xff;
  return b;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const tb = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  out.set(be32(data.length), 0);
  out.set(tb, 4);
  out.set(data, 8);
  const crcIn = new Uint8Array(4 + data.length);
  crcIn.set(tb, 0);
  crcIn.set(data, 4);
  out.set(be32(crc32(crcIn)), 8 + data.length);
  return out;
}

// Encode an RGB buffer (w*h*3) as an 8-bit RGB PNG, no interlace.
function toPNG(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(be32(w), 0);
  ihdr.set(be32(h), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: None
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ============================================================ Canvas =====
const W = 1024;
const H = 1024;
type RGB = [number, number, number];
const PAPER: RGB = [252, 250, 246];
const INK: RGB = [18, 18, 18];
const RED: RGB = [176, 32, 32];
const GREY: RGB = [110, 108, 104];

const px = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  px[i * 3] = PAPER[0];
  px[i * 3 + 1] = PAPER[1];
  px[i * 3 + 2] = PAPER[2];
}

function dot(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 3;
      px[i] = c[0];
      px[i + 1] = c[1];
      px[i + 2] = c[2];
    }
  }
}

function hrule(x: number, y: number, w: number, c: RGB): void {
  rect(x, y, w, 1, c);
}

// Bresenham segment.
function seg(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    dot(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// Filled disc, scanline version.
function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    rect(cx - dx, cy + dy, dx * 2 + 1, 1, c);
  }
}

// 1px circle outline, parametric.
function ring(cx: number, cy: number, r: number, c: RGB): void {
  for (let a = 0; a < 360; a++) {
    const rad = (a * Math.PI) / 180;
    dot(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), c);
  }
}

// 1px ellipse outline, parametric.
function oval(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  for (let a = 0; a < 360; a++) {
    const rad = (a * Math.PI) / 180;
    dot(Math.round(cx + rx * Math.cos(rad)), Math.round(cy + ry * Math.sin(rad)), c);
  }
}

// Filled triangle via barycentric sign test over its bounding box.
function tri(
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB,
): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  const d = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
  if (d === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const s = ((x - x0) * (y2 - y0) - (y - y0) * (x2 - x0)) / d;
      const t = ((y - y0) * (x1 - x0) - (x - x0) * (y1 - y0)) / d;
      if (s >= 0 && t >= 0 && s + t <= 1) dot(x, y, c);
    }
  }
}

// ============================================================== Font =====
// Hand-drawn 5x7 bitmap font, bit-packed: each glyph is 7 rows, each row a
// 5-bit number (bit 4 = leftmost pixel, bit 0 = rightmost). All caps, like
// a newspaper front page.
const GLYPHS: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [15, 16, 16, 16, 16, 16, 15],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [15, 16, 16, 19, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [31, 4, 4, 4, 4, 4, 31],
  J: [7, 2, 2, 2, 2, 18, 6],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 25, 21, 19, 19, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [30, 1, 1, 14, 1, 1, 30],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [14, 16, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 2, 4, 4, 4],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 1, 14],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 6, 6],
  ",": [0, 0, 0, 0, 6, 6, 8],
  ":": [0, 6, 6, 0, 6, 6, 0],
  ";": [0, 6, 6, 0, 6, 6, 8],
  "'": [4, 4, 8, 0, 0, 0, 0],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "—": [0, 0, 0, 31, 0, 0, 0],
  "(": [3, 4, 8, 8, 8, 4, 3],
  ")": [24, 4, 2, 2, 2, 4, 24],
  "/": [1, 1, 2, 2, 4, 8, 16],
  "%": [25, 26, 2, 4, 8, 22, 19],
  "&": [14, 17, 20, 8, 21, 18, 13],
  "+": [0, 4, 4, 14, 4, 4, 0],
  "=": [0, 0, 14, 0, 14, 0, 0],
  '"': [10, 10, 0, 0, 0, 0, 0],
};

function clean(s: string): string {
  return s
    .toUpperCase()
    .replace(/[’‘]/g, "'")
    .replace(/[–]/g, "-");
}

// Pixel width of a string at a given scale (5px glyph + 1px gap per char).
function strW(s: string, scale: number): number {
  const n = clean(s).length;
  return n === 0 ? 0 : n * 6 * scale - scale;
}

function text(s: string, x: number, y: number, scale: number, c: RGB): void {
  const t = clean(s);
  let cx = x;
  for (const ch of t) {
    const g = GLYPHS[ch] || GLYPHS[" "];
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let col = 0; col < 5; col++) {
        if ((row >> (4 - col)) & 1) rect(cx + col * scale, y + r * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function textC(s: string, cx: number, y: number, scale: number, c: RGB): void {
  text(s, Math.round(cx - strW(s, scale) / 2), y, scale, c);
}

// Greedy word wrap: lines whose pixel width fits maxW.
function wrap(s: string, maxW: number, scale: number): string[] {
  const words = clean(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (strW(test, scale) <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ============================================================= Icons =====
// Simple geometric pictograms in a 122x58 box at (bx, by). Abstract and
// clean: the text carries the meaning, the icon anchors it.
function iconChip(bx: number, by: number): void {
  // Microchip: dark body, red die, pins on all four sides, traces out.
  rect(bx + 36, by + 12, 50, 34, INK); // body
  rect(bx + 46, by + 20, 30, 18, RED); // die
  rect(bx + 54, by + 26, 14, 6, PAPER); // die window
  // pins: top, bottom, left, right
  for (let i = 0; i < 5; i++) {
    rect(bx + 40 + i * 9, by + 6, 5, 6, INK);
    rect(bx + 40 + i * 9, by + 46, 5, 6, INK);
  }
  for (let i = 0; i < 3; i++) {
    rect(bx + 30, by + 16 + i * 11, 6, 5, INK);
    rect(bx + 86, by + 16 + i * 11, 6, 5, INK);
  }
  // circuit traces to the edges
  seg(bx + 14, by + 18, bx + 30, by + 18, INK);
  seg(bx + 14, by + 40, bx + 30, by + 40, INK);
  seg(bx + 92, by + 18, bx + 108, by + 18, INK);
  seg(bx + 92, by + 40, bx + 108, by + 40, INK);
}

function iconBank(bx: number, by: number): void {
  // Bank with a pediment and three columns, crossed by a red ban slash.
  tri(bx + 26, by + 12, bx + 61, by + 0, bx + 96, by + 12, INK); // pediment
  rect(bx + 26, by + 14, 70, 4, INK); // architrave
  rect(bx + 30, by + 20, 8, 26, INK); // columns
  rect(bx + 57, by + 20, 8, 26, INK);
  rect(bx + 84, by + 20, 8, 26, INK);
  rect(bx + 24, by + 48, 74, 4, INK); // base
  rect(bx + 20, by + 52, 82, 4, INK); // steps
  // red ban circle + slash over the bank
  ring(bx + 61, by + 29, 27, RED);
  seg(bx + 42, by + 48, bx + 80, by + 10, RED);
  seg(bx + 43, by + 48, bx + 81, by + 10, RED);
}

function iconBlast(bx: number, by: number): void {
  // Warship struck by a blast: hull, tower, red starburst above.
  rect(bx + 6, by + 38, 96, 9, INK); // hull
  tri(bx + 102, by + 38, bx + 118, by + 42, bx + 102, by + 47, INK); // bow
  rect(bx + 40, by + 28, 24, 10, INK); // tower
  seg(bx + 52, by + 28, bx + 52, by + 20, INK); // mast
  // starburst: 12 rays, alternating long/short, red
  const cx = bx + 52;
  const cy = by + 11;
  for (let a = 0; a < 12; a++) {
    const rad = (a * Math.PI) / 6;
    const len = a % 2 === 0 ? 15 : 9;
    seg(cx, cy, Math.round(cx + len * Math.cos(rad)), Math.round(cy + len * Math.sin(rad)), RED);
  }
  disc(cx, cy, 5, RED);
  disc(cx, cy, 2, PAPER); // hot core
  // smoke puffs
  disc(bx + 18, by + 16, 5, INK);
  disc(bx + 92, by + 18, 4, INK);
}

function iconFlame(bx: number, by: number): void {
  // Factory with a sawtooth roof, a chimney, and a flame rising.
  rect(bx + 18, by + 26, 64, 28, INK); // hall
  tri(bx + 18, by + 26, bx + 34, by + 16, bx + 50, by + 26, PAPER); // roof notch
  tri(bx + 50, by + 26, bx + 66, by + 16, bx + 82, by + 26, PAPER); // roof notch
  rect(bx + 88, by + 10, 10, 44, INK); // chimney
  rect(bx + 86, by + 8, 14, 4, INK); // chimney cap
  // windows (paper cutouts)
  for (let c = 0; c < 4; c++) rect(bx + 24 + c * 14, by + 32, 8, 8, PAPER);
  // flame above the hall: teardrop of triangle + disc, red
  tri(bx + 44, by + 22, bx + 52, by + 0, bx + 60, by + 22, RED);
  disc(bx + 52, by + 16, 6, RED);
  disc(bx + 52, by + 18, 3, PAPER); // inner glow
  // smoke from the chimney
  disc(bx + 104, by + 4, 3, INK);
  disc(bx + 110, by + 0, 2, INK);
}

function iconGlobe(bx: number, by: number): void {
  // Globe with a bold red crack through it.
  const cx = bx + 56;
  const cy = by + 29;
  ring(cx, cy, 23, INK);
  oval(cx, cy, 23, 10, INK); // equator
  oval(cx, cy, 10, 23, INK); // meridian
  // crack: zigzag across, drawn twice for a 2px stroke
  const pts: [number, number][] = [
    [cx - 21, cy - 15],
    [cx - 9, cy - 3],
    [cx - 15, cy + 9],
    [cx + 1, cy + 17],
    [cx + 15, cy + 21],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], RED);
    seg(pts[i][0], pts[i][1] + 1, pts[i + 1][0], pts[i + 1][1] + 1, RED);
  }
}

function iconTrophy(bx: number, by: number): void {
  // Trophy cup with handles, a stem and base, a star above, a pawn beside.
  tri(bx + 36, by + 10, bx + 86, by + 10, bx + 80, by + 32, INK); // bowl
  tri(bx + 42, by + 10, bx + 80, by + 10, bx + 74, by + 32, PAPER); // bowl hollow
  rect(bx + 36, by + 10, 50, 4, INK); // rim
  seg(bx + 36, by + 14, bx + 26, by + 24, INK); // left handle
  seg(bx + 26, by + 24, bx + 36, by + 30, INK);
  seg(bx + 86, by + 14, bx + 96, by + 24, INK); // right handle
  seg(bx + 96, by + 24, bx + 86, by + 30, INK);
  rect(bx + 58, by + 32, 6, 10, INK); // stem
  rect(bx + 46, by + 42, 30, 5, INK); // base
  rect(bx + 42, by + 47, 38, 4, INK); // plinth
  // star above the cup: a bold red disc with a paper centre
  disc(bx + 61, by + 3, 4, RED);
  disc(bx + 61, by + 3, 1, PAPER);
  // chess pawn beside the trophy (right side): bigger, clearer silhouette
  disc(bx + 108, by + 38, 7, INK); // pawn head
  tri(bx + 101, by + 46, bx + 115, by + 46, bx + 108, by + 54, INK); // pawn body
  rect(bx + 98, by + 54, 20, 3, INK); // pawn base
}

const ICONS: Record<string, (bx: number, by: number) => void> = {
  chip: iconChip,
  bank: iconBank,
  blast: iconBlast,
  flame: iconFlame,
  globe: iconGlobe,
  trophy: iconTrophy,
};

// ============================================================ Content =====
// Verified facts only (reported 24 Nov 2026, CNN / USA Today / Treasury /
// BBC / France 24 / AP / Reuters / AFP). No hype, no speculation.
type Story = { kicker: string; headline: string; summary: string; icon: string };
const STORIES: Story[] = [
  {
    kicker: "NVIDIA — SILICON VALLEY",
    headline: "HUANG RETURNS AS NVIDIA CEO",
    summary: "BOARD REINSTATES JENSEN HUANG AFTER TRUMP PRESSED THE BOARD.",
    icon: "chip",
  },
  {
    kicker: "WASHINGTON",
    headline: "US SANCTIONS IRAN SHADOW BANKS",
    summary: "TREASURY CUTS THE LAST FINANCIAL LIFELINE, BESSENT SAYS.",
    icon: "bank",
  },
  {
    kicker: "BENGHAZI, LIBYA",
    headline: "UKRAINE SINKS RUSSIAN WARSHIP",
    summary: "DRONES HIT THE MERKURY AT BENGHAZI. CARGO SHIP SPARTA II BURNS.",
    icon: "blast",
  },
  {
    kicker: "BANTEN, INDONESIA",
    headline: "DEADLY FACTORY FIRE IN BANTEN",
    summary: "AT LEAST 24 DEAD AND 34 MISSING AFTER A CANDY FACTORY FIRE.",
    icon: "flame",
  },
  {
    kicker: "COP31 — ANTALYA",
    headline: "COP31 ENDS WITHOUT A DEAL",
    summary: "TALKS COLLAPSE WITH NO FOSSIL FUEL AGREEMENT.",
    icon: "globe",
  },
  {
    kicker: "SPORT",
    headline: "ALCARAZ WINS ATP FINALS",
    summary: "CHESS TITLE MATCH: GUKESH VS SINDAROV OPENS IN GENEVA TODAY.",
    icon: "trophy",
  },
];

// ============================================================= Layout =====
const MX = 40;
const CW = W - MX * 2; // 944
const COLW = 460;
const COLGAP = CW - COLW * 2; // 24
const ROWH = 258;
const ROWGAP = 12;
const STORIES_Y = 158;

function storyBlock(s: Story, bx: number, by: number): void {
  // Kicker (red, small caps).
  text(s.kicker, bx, by, 2, RED);
  // Headline, up to 2 lines, large.
  const head = wrap(s.headline, COLW, 4).slice(0, 2);
  head.forEach((ln, i) => text(ln, bx, by + 22 + i * 34, 4, INK));
  // Summary, up to 3 lines, smaller.
  const sum = wrap(s.summary, COLW, 3).slice(0, 3);
  sum.forEach((ln, i) => text(ln, bx, by + 96 + i * 26, 3, INK));
  // Divider, then the pictogram centred in the strip.
  hrule(bx, by + 182, COLW, GREY);
  hrule(bx, by + 183, COLW, GREY);
  const fn = ICONS[s.icon];
  if (fn) fn(bx + Math.round((COLW - 122) / 2), by + 192);
}

function drawPage(): void {
  // Masthead.
  textC("THE WORLD IN ONE DAY", W / 2, 34, 4, INK);
  textC("TUESDAY 24 NOVEMBER 2026", W / 2, 74, 6, INK);
  // Rules under the masthead.
  rect(MX, 130, CW, 6, RED);
  rect(MX, 140, CW, 2, INK);
  // Six stories: 2 columns x 3 rows.
  for (let i = 0; i < STORIES.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx = MX + col * (COLW + COLGAP);
    const by = STORIES_Y + row * (ROWH + ROWGAP);
    storyBlock(STORIES[i], bx, by);
  }
  // Footer.
  rect(MX, 962, CW, 2, INK);
  textC("24 NOVEMBER 2026 — THE DAY IN WORLD NEWS", W / 2, 972, 2, INK);
  textC("SOURCES: AP, REUTERS, AFP, AL JAZEERA, UKMTO", W / 2, 992, 2, GREY);
}

// =============================================================== Main =====
drawPage();
const png = toPNG(W, H, px);
const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), png);
