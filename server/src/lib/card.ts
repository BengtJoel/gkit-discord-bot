import { createCanvas, GlobalFonts, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import { log } from "./log.js";

/**
 * Welcome card: the banner image with the member's avatar and name drawn on top,
 * like MEE6's welcome cards. Rendered on the server and sent as an attachment.
 */

const W = 1100;
const H = 400;

const fontDir = fileURLToPath(new URL("../../assets/fonts/", import.meta.url));
let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  fontsReady = true;
  try {
    GlobalFonts.registerFromPath(`${fontDir}Inter-Bold.woff2`, "GK Inter");
    GlobalFonts.registerFromPath(`${fontDir}Inter-Medium.woff2`, "GK Inter Medium");
    // DejaVu covers characters Inter lacks (Cyrillic, Greek, symbols) so names never turn into boxes
    GlobalFonts.registerFromPath(`${fontDir}DejaVuSans-Bold.ttf`, "GK DejaVu Bold");
    GlobalFonts.registerFromPath(`${fontDir}DejaVuSans.ttf`, "GK DejaVu");
  } catch (err) {
    log.warn({ err }, "Card fonts could not be loaded");
  }
}
const BOLD = `"GK Inter", "GK DejaVu Bold", sans-serif`;
const MEDIUM = `"GK Inter Medium", "GK DejaVu", sans-serif`;

export interface CardStyle {
  layout: "center" | "left";
  textColor: string;
  /** 0–90: how much the background is darkened so text stays readable */
  overlay: number;
  /** Ring around the avatar */
  accentColor: string;
}

export interface CardInput {
  background: Buffer | null;
  avatar: Buffer | null;
  /** Shown as a letter if the avatar can't be loaded */
  initial: string;
  title: string;
  subtitle: string;
  style: CardStyle;
}

/** Background images are reused for every join, so keep a few decoded */
const bgCache = new Map<string, Image>();
async function decode(buf: Buffer, cacheKey?: string) {
  if (cacheKey && bgCache.has(cacheKey)) return bgCache.get(cacheKey)!;
  const img = await loadImage(buf);
  if (cacheKey) {
    if (bgCache.size > 20) bgCache.delete(bgCache.keys().next().value!);
    bgCache.set(cacheKey, img);
  }
  return img;
}

/** Downloads an image with a time and size limit (avatars and linked backgrounds) */
export async function fetchImage(url: string, maxBytes = 8 * 1024 * 1024): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= maxBytes ? buf : null;
  } catch {
    return null;
  }
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

function cover(ctx: SKRSContext2D, img: Image) {
  const s = Math.max(W / img.width, H / img.height);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

/** Largest font size (down to min) at which the text fits; ellipsized if it still doesn't */
function fitText(ctx: SKRSContext2D, text: string, family: string, max: number, min: number, width: number) {
  let size = max;
  for (; size > min; size -= 2) {
    ctx.font = `${size}px ${family}`;
    if (ctx.measureText(text).width <= width) return { text, size };
  }
  ctx.font = `${min}px ${family}`;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return { text: t === text ? t : `${t.trimEnd()}…`, size: min };
}

export async function renderCard(input: CardInput, backgroundKey?: string): Promise<Buffer> {
  ensureFonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const { style } = input;
  const [ar, ag, ab] = hexToRgb(style.accentColor);

  // Background: image, or a gradient in the accent colour
  const bg = input.background ? await decode(input.background, backgroundKey).catch(() => null) : null;
  if (bg) cover(ctx, bg);
  else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `rgb(${Math.round(ar * 0.55)}, ${Math.round(ag * 0.55)}, ${Math.round(ab * 0.55)})`);
    g.addColorStop(1, "#0b0b10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (style.overlay > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(style.overlay, 90) / 100})`;
    ctx.fillRect(0, 0, W, H);
  }

  const center = style.layout === "center";
  const r = center ? 88 : 115;
  const cx = center ? W / 2 : 70 + r;
  const cy = center ? 40 + r : H / 2;

  // Avatar with a ring and a soft shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
  ctx.fillStyle = style.accentColor;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const av = input.avatar ? await loadImage(input.avatar).catch(() => null) : null;
  if (av) ctx.drawImage(av, cx - r, cy - r, r * 2, r * 2);
  else {
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(r)}px ${BOLD}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(input.initial.toUpperCase().slice(0, 1) || "?", cx, cy + 4);
  }
  ctx.restore();

  // Text
  ctx.fillStyle = style.textColor;
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  if (center) {
    ctx.textAlign = "center";
    const t = fitText(ctx, input.title, BOLD, 56, 30, W - 120);
    ctx.font = `${t.size}px ${BOLD}`;
    ctx.fillText(t.text, W / 2, cy + r + 76);
    if (input.subtitle) {
      const s = fitText(ctx, input.subtitle, MEDIUM, 30, 20, W - 160);
      ctx.font = `${s.size}px ${MEDIUM}`;
      ctx.globalAlpha = 0.85;
      ctx.fillText(s.text, W / 2, cy + r + 120);
    }
  } else {
    ctx.textAlign = "left";
    const x = cx + r + 50;
    const width = W - x - 60;
    const t = fitText(ctx, input.title, BOLD, 64, 30, width);
    ctx.font = `${t.size}px ${BOLD}`;
    ctx.fillText(t.text, x, input.subtitle ? H / 2 - 4 : H / 2 + t.size / 3);
    if (input.subtitle) {
      const s = fitText(ctx, input.subtitle, MEDIUM, 32, 20, width);
      ctx.font = `${s.size}px ${MEDIUM}`;
      ctx.globalAlpha = 0.85;
      ctx.fillText(s.text, x, H / 2 + 46);
    }
  }
  return canvas.toBuffer("image/png");
}
