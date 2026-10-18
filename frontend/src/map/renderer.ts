/**
 * Renderer táctico en Canvas 2D a 60 FPS.
 * Capas: terreno georreferenciado → radar → KDE (+isolíneas) → trazas → predicción
 * → hotspots → drones con pulso IR  |  RF: sombra urbana, EMI, ruido, posiciones degradadas.
 */
import { THERMAL_LUT, irColor } from '../engine/colormap';
import { store } from '../engine/store';
import type { DroneState, Frame, RFState, SimConfig } from '../engine/types';

export interface Insets { top: number; right: number; bottom: number; left: number }
interface View { cx: number; cy: number; scale: number }

const CYAN = '#00F0FF';
const AMBER = '#FFB020';
const VIOLET = '#A855F7';
const MONO = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';
const SANS = '"Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif';

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
};
const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

export class MapRenderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  view: View = { cx: 0, cy: 0, scale: 0.2 };
  target: View | null = null;
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  compact = false;
  fitted = false;
  cursor: { x: number; y: number } | null = null;
  hits: { id: string; x: number; y: number }[] = [];
  splitX = 0;

  private heatSmall = document.createElement('canvas');
  private heatMid = document.createElement('canvas');
  private heatImg: ImageData | null = null;
  private noise = document.createElement('canvas');
  private hatch: CanvasPattern | null = null;
  private contours: { level: number; segs: Float32Array }[] = [];
  private contourSeq = -1;
  private blended = new Float32Array(0);
  private terrainKey = '';
  private terrain = document.createElement('canvas');
  private lastFocus = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.heatMid.width = this.heatMid.height = 288;
    // ruido de interferencia RF
    this.noise.width = this.noise.height = 160;
    const nctx = this.noise.getContext('2d')!;
    const img = nctx.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = v; img.data[i + 1] = v * 0.6; img.data[i + 2] = v * 0.5;
      img.data[i + 3] = Math.random() < 0.5 ? 60 : 0;
    }
    nctx.putImageData(img, 0, 0);
    const hc = document.createElement('canvas');
    hc.width = hc.height = 10;
    const hx = hc.getContext('2d')!;
    hx.strokeStyle = 'rgba(255,42,84,0.22)';
    hx.lineWidth = 1;
    hx.beginPath(); hx.moveTo(0, 10); hx.lineTo(10, 0); hx.stroke();
    this.hatch = this.ctx.createPattern(hc, 'repeat');
  }

  resize(w: number, h: number, dpr: number) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.terrain.width = this.canvas.width;
    this.terrain.height = this.canvas.height;
    this.terrainKey = '';
    if (!this.fitted) this.fit(false);
    if (!this.splitX || this.splitX > w) this.splitX = this.freeCenterX();
  }

  freeCenterX() {
    return this.insets.left + (this.w - this.insets.left - this.insets.right) / 2;
  }

  fit(animate = true) {
    const ext = store.config?.extent ?? 4000;
    const fw = Math.max(120, this.w - this.insets.left - this.insets.right);
    const fh = Math.max(120, this.h - this.insets.top - this.insets.bottom);
    const scale = Math.min(fw, fh) / (ext * (this.compact ? 0.86 : 1.02));
    // centra el área de operación en la región libre de paneles
    const offX = (this.insets.left - this.insets.right) / 2;
    const offY = (this.insets.top - this.insets.bottom) / 2;
    const v = { cx: -offX / scale, cy: offY / scale, scale };
    if (animate) this.target = v; else this.view = v;
    this.fitted = true;
  }

  zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wy] = this.toWorld(sx, sy);
    const scale = Math.min(4, Math.max(0.04, this.view.scale * factor));
    this.view = { scale, cx: wx - (sx - this.w / 2) / scale, cy: wy + (sy - this.h / 2) / scale };
    this.target = null;
  }
  pan(dx: number, dy: number) {
    this.view = { ...this.view, cx: this.view.cx - dx / this.view.scale, cy: this.view.cy + dy / this.view.scale };
    this.target = null;
  }
  focus(x: number, y: number) {
    this.target = { cx: x, cy: y, scale: Math.max(this.view.scale, 0.42) };
  }

  sx(x: number) { return this.w / 2 + (x - this.view.cx) * this.view.scale; }
  sy(y: number) { return this.h / 2 - (y - this.view.cy) * this.view.scale; }
  toWorld(sx: number, sy: number): [number, number] {
    return [this.view.cx + (sx - this.w / 2) / this.view.scale, this.view.cy - (sy - this.h / 2) / this.view.scale];
  }

  // ===================================================================== FRAME
  draw(now: number) {
    const { ctx } = this;
    const cfg = store.config;
    const ui = store.ui;
    if (this.target) {
      const k = 0.14;
      this.view = { cx: lerp(this.view.cx, this.target.cx, k), cy: lerp(this.view.cy, this.target.cy, k), scale: lerp(this.view.scale, this.target.scale, k) };
      if (Math.abs(this.view.scale - this.target.scale) < 1e-4 && Math.hypot(this.view.cx - this.target.cx, this.view.cy - this.target.cy) < 0.5) this.target = null;
    }
    if (store.focusReq && store.focusReq.seq !== this.lastFocus) {
      this.lastFocus = store.focusReq.seq;
      this.focus(store.focusReq.x, store.focusReq.y);
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#04070F';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!cfg) { this.drawBoot(now); return; }

    this.drawTerrain(cfg);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.terrain, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const replay = ui.replay.active && store.history.length > 0;
    const mode = replay ? 'kde' : ui.mode;
    const frame = store.frame;
    const t = Math.min(1, Math.max(0, (now - store.frameAt) / 100));

    if (mode === 'split') {
      this.splitX = Math.min(this.w - 40, Math.max(40, this.splitX));
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, this.splitX, this.h); ctx.clip();
      this.drawRF(cfg, frame, now);
      ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(this.splitX, 0, this.w - this.splitX, this.h); ctx.clip();
      this.drawKDE(cfg, frame, t, now, replay);
      ctx.restore();
      this.drawSplitter(now);
    } else if (mode === 'rf') {
      this.drawRF(cfg, frame, now);
    } else {
      this.drawKDE(cfg, frame, t, now, replay);
    }
    this.drawHUD(cfg, now, mode, replay);
  }

  private drawBoot(now: number) {
    const { ctx } = this;
    ctx.fillStyle = CYAN;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 200);
    ctx.font = `600 12px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText('ESTABLECIENDO ENLACE DE TELEMETRÍA…', this.w / 2, this.h / 2);
    ctx.globalAlpha = 1;
  }

  // =================================================================== TERRAIN
  private drawTerrain(cfg: SimConfig) {
    const key = `${this.w}|${this.h}|${this.view.cx.toFixed(2)}|${this.view.cy.toFixed(2)}|${this.view.scale.toFixed(5)}|${store.ui.scenario}|${store.ui.mode}`;
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    const ctx = this.terrain.getContext('2d')!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const H = cfg.extent / 2;
    const s = this.view.scale;
    const x0 = this.sx(-H), y0 = this.sy(H), size = cfg.extent * s;

    // fondo profundo + viñeta
    const bg = ctx.createRadialGradient(this.w / 2, this.h / 2, 0, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.75);
    bg.addColorStop(0, '#0A1222'); bg.addColorStop(1, '#03060D');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.w, this.h);

    // trama exterior al área de operación
    ctx.fillStyle = 'rgba(9,14,26,0.85)';
    ctx.fillRect(x0, y0, size, size);

    const rng = mulberry32(4300 + store.ui.scenario.length);
    const scen = store.ui.scenario;

    if (scen === 'agriculture') this.drawFields(ctx, rng);
    else this.drawCity(ctx, rng, scen === 'emergency');

    // malla 100 m / 500 m
    ctx.lineWidth = 1;
    if (s * 100 > 14) {
      ctx.strokeStyle = 'rgba(0,240,255,0.035)';
      ctx.beginPath();
      for (let m = -H; m <= H; m += 100) {
        ctx.moveTo(this.sx(m), y0); ctx.lineTo(this.sx(m), y0 + size);
        ctx.moveTo(x0, this.sy(m)); ctx.lineTo(x0 + size, this.sy(m));
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,240,255,0.08)';
    ctx.beginPath();
    for (let m = -H; m <= H; m += 500) {
      ctx.moveTo(this.sx(m) + 0.5, y0); ctx.lineTo(this.sx(m) + 0.5, y0 + size);
      ctx.moveTo(x0, this.sy(m) + 0.5); ctx.lineTo(x0 + size, this.sy(m) + 0.5);
    }
    ctx.stroke();

    // graticula lat/lon
    const { lat, lon } = cfg.origin;
    const mLat = 111320, mLon = 111320 * Math.cos((lat * Math.PI) / 180);
    const step = s > 0.5 ? 0.0025 : 0.005;
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = 'rgba(143,163,191,0.75)';
    ctx.strokeStyle = 'rgba(168,85,247,0.10)';
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    for (let la = Math.ceil((lat - H / mLat) / step) * step; la <= lat + H / mLat; la += step) {
      const y = this.sy((la - lat) * mLat);
      ctx.moveTo(x0, y); ctx.lineTo(x0 + size, y);
    }
    for (let lo = Math.ceil((lon - H / mLon) / step) * step; lo <= lon + H / mLon; lo += step) {
      const x = this.sx((lo - lon) * mLon);
      ctx.moveTo(x, y0); ctx.lineTo(x, y0 + size);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    for (let la = Math.ceil((lat - H / mLat) / step) * step; la <= lat + H / mLat; la += step) {
      const y = this.sy((la - lat) * mLat);
      ctx.fillText(`${la.toFixed(4)}°N`, Math.max(x0, this.insets.left) + 6, y - 3);
    }
    ctx.textAlign = 'center';
    for (let lo = Math.ceil((lon - H / mLon) / step) * step; lo <= lon + H / mLon; lo += step) {
      const x = this.sx((lo - lon) * mLon);
      ctx.fillText(`${Math.abs(lo).toFixed(4)}°W`, x, Math.min(y0 + size, this.h - this.insets.bottom) - 6);
    }

    // marco del área
    ctx.strokeStyle = 'rgba(0,240,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, size, size);
    const c = 14;
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 2;
    for (const [px, py, dx, dy] of [[x0, y0, 1, 1], [x0 + size, y0, -1, 1], [x0, y0 + size, 1, -1], [x0 + size, y0 + size, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(px, py + dy * c); ctx.lineTo(px, py); ctx.lineTo(px + dx * c, py); ctx.stroke();
    }

    // zonas urbanas densas (sombra RF): sutiles en KDE, marcadas en RF
    const strong = store.ui.mode !== 'kde';
    for (const z of cfg.urban_zones) {
      ctx.beginPath();
      ctx.arc(this.sx(z.x), this.sy(z.y), z.r * s, 0, Math.PI * 2);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = strong ? 'rgba(255,42,84,0.35)' : 'rgba(255,42,84,0.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  private drawCity(ctx: CanvasRenderingContext2D, rng: () => number, emergency: boolean) {
    const H = 2000, s = this.view.scale, cfg = store.config!;
    // río
    ctx.beginPath();
    for (let x = -H; x <= H; x += 40) {
      const y = -260 + 280 * Math.sin(x / 640) + 90 * Math.sin(x / 210);
      if (x === -H) ctx.moveTo(this.sx(x), this.sy(y)); else ctx.lineTo(this.sx(x), this.sy(y));
    }
    ctx.strokeStyle = 'rgba(20,70,120,0.55)';
    ctx.lineWidth = Math.max(3, 48 * s);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,240,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const B = 250, street = 26;
    for (let bx = -H; bx < H; bx += B) {
      for (let by = -H; by < H; by += B) {
        const cx = bx + B / 2, cy = by + B / 2;
        const ry = -260 + 280 * Math.sin(cx / 640) + 90 * Math.sin(cx / 210);
        if (Math.abs(cy - ry) < 110) continue;
        let dense = 0;
        for (const z of cfg.urban_zones) dense = Math.max(dense, 1 - Math.hypot(cx - z.x, cy - z.y) / z.r);
        const parts = dense > 0.2 ? 3 : rng() < 0.5 ? 2 : 1;
        const inner = B - street * 2;
        const cell = inner / parts;
        for (let i = 0; i < parts; i++) for (let j = 0; j < parts; j++) {
          if (rng() < 0.12 && dense < 0.2) continue;
          const pad = 6 + rng() * 8;
          const x = bx + street + i * cell + pad, y = by + street + j * cell + pad;
          const w = cell - pad * 2, h = cell - pad * 2;
          const lum = 0.05 + dense * 0.12 + rng() * 0.05;
          ctx.fillStyle = emergency ? `rgba(60,40,70,${lum + 0.1})` : `rgba(28,52,92,${lum + 0.12})`;
          ctx.fillRect(this.sx(x), this.sy(y + h), w * s, h * s);
          if (s > 0.18) {
            ctx.strokeStyle = `rgba(0,240,255,${0.04 + dense * 0.08})`;
            ctx.strokeRect(this.sx(x) + 0.5, this.sy(y + h) + 0.5, w * s, h * s);
          }
        }
      }
    }
    // avenidas principales
    ctx.strokeStyle = 'rgba(120,160,210,0.10)';
    ctx.lineWidth = Math.max(1, 14 * s);
    ctx.beginPath();
    for (let m = -1500; m <= 1500; m += 1000) {
      ctx.moveTo(this.sx(m), this.sy(H)); ctx.lineTo(this.sx(m), this.sy(-H));
      ctx.moveTo(this.sx(-H), this.sy(m)); ctx.lineTo(this.sx(H), this.sy(m));
    }
    ctx.moveTo(this.sx(-H), this.sy(-H * 0.7)); ctx.lineTo(this.sx(H), this.sy(H * 0.9));
    ctx.stroke();
  }

  private drawFields(ctx: CanvasRenderingContext2D, rng: () => number) {
    const s = this.view.scale;
    const fields: [number, number, number, number, string][] = [
      [-1850, 250, -250, 1800, 'LOTE A-1 · MAÍZ'],
      [150, 350, 1850, 1800, 'LOTE A-2 · CAFÉ'],
      [-1850, -1800, -350, -150, 'LOTE B-1 · PAPA'],
      [250, -1800, 1850, -250, 'LOTE B-2 · FLORES'],
    ];
    // vegetación dispersa
    for (let i = 0; i < 420; i++) {
      const x = (rng() - 0.5) * 4000, y = (rng() - 0.5) * 4000;
      ctx.fillStyle = `rgba(52,211,153,${0.04 + rng() * 0.06})`;
      ctx.beginPath(); ctx.arc(this.sx(x), this.sy(y), Math.max(1, (8 + rng() * 18) * s), 0, Math.PI * 2); ctx.fill();
    }
    fields.forEach(([x0, y0, x1, y1, label], k) => {
      const X = this.sx(x0), Y = this.sy(y1), W = (x1 - x0) * s, Hh = (y1 - y0) * s;
      const g = ctx.createLinearGradient(X, Y, X + W, Y + Hh);
      g.addColorStop(0, `rgba(20,${70 + k * 8},60,0.30)`);
      g.addColorStop(1, `rgba(10,${45 + k * 6},50,0.22)`);
      ctx.fillStyle = g;
      ctx.fillRect(X, Y, W, Hh);
      ctx.strokeStyle = 'rgba(52,211,153,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const rows = k % 2 ? 'v' : 'h';
      const spacing = 35;
      if (rows === 'h') for (let y = y0; y < y1; y += spacing) { ctx.moveTo(X, this.sy(y)); ctx.lineTo(X + W, this.sy(y)); }
      else for (let x = x0; x < x1; x += spacing) { ctx.moveTo(this.sx(x), Y); ctx.lineTo(this.sx(x), Y + Hh); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(52,211,153,0.28)';
      ctx.strokeRect(X + 0.5, Y + 0.5, W, Hh);
      ctx.fillStyle = 'rgba(167,243,208,0.55)';
      ctx.font = `600 ${this.compact ? 8 : 9}px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillText(label, X + 8, Y + 14);
    });
    ctx.strokeStyle = 'rgba(180,160,120,0.16)';
    ctx.lineWidth = Math.max(1, 12 * s);
    ctx.beginPath();
    ctx.moveTo(this.sx(-2000), this.sy(60)); ctx.lineTo(this.sx(2000), this.sy(60));
    ctx.moveTo(this.sx(-60), this.sy(2000)); ctx.lineTo(this.sx(-60), this.sy(-2000));
    ctx.stroke();
  }

  // ======================================================================= KDE
  private updateHeat(grid: Uint8Array, prevGrid: Uint8Array | undefined, t: number, n: number) {
    if (this.heatSmall.width !== n) {
      this.heatSmall.width = this.heatSmall.height = n;
      this.heatImg = this.heatSmall.getContext('2d')!.createImageData(n, n);
      this.blended = new Float32Array(n * n);
    }
    const img = this.heatImg!;
    const d = img.data;
    for (let i = 0; i < n * n; i++) {
      const v = prevGrid && prevGrid.length === grid.length ? prevGrid[i] + (grid[i] - prevGrid[i]) * t : grid[i];
      this.blended[i] = v / 255;
      const k = (v | 0) * 4;
      d[i * 4] = THERMAL_LUT[k]; d[i * 4 + 1] = THERMAL_LUT[k + 1]; d[i * 4 + 2] = THERMAL_LUT[k + 2]; d[i * 4 + 3] = THERMAL_LUT[k + 3];
    }
    this.heatSmall.getContext('2d')!.putImageData(img, 0, 0);
    const mid = this.heatMid.getContext('2d')!;
    mid.clearRect(0, 0, 288, 288);
    mid.imageSmoothingEnabled = true;
    mid.imageSmoothingQuality = 'high';
    mid.filter = 'blur(3px)';
    mid.drawImage(this.heatSmall, 0, 0, 288, 288);
    mid.filter = 'none';
  }

  private computeContours(grid: Uint8Array, n: number, seq: number) {
    if (seq === this.contourSeq) return;
    this.contourSeq = seq;
    const levels = [0.3, 0.55, 0.8];
    const H = (store.config?.extent ?? 4000) / 2;
    const cell = (2 * H) / n;
    this.contours = levels.map((level) => {
      const L = level * 255;
      const segs: number[] = [];
      const wx = (i: number) => -H + (i + 0.5) * cell;
      const wy = (j: number) => H - (j + 0.5) * cell;
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = grid[j * n + i], b = grid[j * n + i + 1], c = grid[(j + 1) * n + i + 1], d = grid[(j + 1) * n + i];
        const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const ip = (p: number, q: number) => (L - p) / (q - p || 1e-6);
        const top: [number, number] = [wx(i + ip(a, b)), wy(j)];
        const right: [number, number] = [wx(i + 1), wy(j + ip(b, c))];
        const bottom: [number, number] = [wx(i + ip(d, c)), wy(j + 1)];
        const left: [number, number] = [wx(i), wy(j + ip(a, d))];
        const add = (p: [number, number], q: [number, number]) => segs.push(p[0], p[1], q[0], q[1]);
        switch (idx) {
          case 1: case 14: add(left, bottom); break;
          case 2: case 13: add(bottom, right); break;
          case 3: case 12: add(left, right); break;
          case 4: case 11: add(top, right); break;
          case 5: add(left, top); add(bottom, right); break;
          case 6: case 9: add(top, bottom); break;
          case 7: case 8: add(left, top); break;
          case 10: add(top, right); add(left, bottom); break;
        }
      }
      return { level, segs: new Float32Array(segs) };
    });
  }

  private drawKDE(cfg: SimConfig, frame: Frame | null, t: number, now: number, replay: boolean) {
    const { ctx } = this;
    const ui = store.ui;
    const H = cfg.extent / 2;
    const s = this.view.scale;
    if (ui.layers.radar) this.drawRadar(cfg, now, CYAN);

    let grid: Uint8Array | undefined;
    let prevGrid: Uint8Array | undefined;
    let drones: { id: string; x: number; y: number; ir: number; alt: number; hrad: number; callsign?: string; thermal?: number }[] = [];
    let hotspots = frame?.hotspots ?? [];
    let seq = frame?.seq ?? 0;

    if (replay) {
      const idx = Math.min(ui.replay.index, store.history.length - 1);
      const snap = store.history[idx];
      const nxt = store.history[Math.min(idx + 1, store.history.length - 1)];
      grid = snap.grid;
      hotspots = snap.hotspots;
      seq = -idx - 1;
      drones = snap.drones.map((d) => {
        const n2 = nxt.drones.find((q) => q.id === d.id) ?? d;
        const pv = idx > 0 ? store.history[idx - 1].drones.find((q) => q.id === d.id) ?? d : d;
        return { ...d, hrad: Math.atan2(n2.y - pv.y, n2.x - pv.x) };
      });
      t = 1;
    } else if (frame) {
      grid = frame.grid;
      prevGrid = store.prev?.grid;
      const prevMap = new Map((store.prev?.drones ?? []).map((d) => [d.id, d]));
      drones = frame.drones.map((d) => {
        const p = prevMap.get(d.id) ?? d;
        return { id: d.id, callsign: d.callsign, thermal: d.thermal, x: lerp(p.x, d.x, t), y: lerp(p.y, d.y, t), ir: d.ir, alt: d.alt, hrad: lerpAngle(p.hrad, d.hrad, t) };
      });
    }

    // --- mapa de calor
    if (grid && ui.layers.heat) {
      const n = Math.round(Math.sqrt(grid.length));
      this.updateHeat(grid, prevGrid, t, n);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'screen';
      const x0 = this.sx(-H), y0 = this.sy(H), size = cfg.extent * s;
      ctx.drawImage(this.heatMid, x0, y0, size, size);
      ctx.globalAlpha = 0.45;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.heatMid, x0, y0, size, size);
      ctx.restore();

      if (ui.layers.contours) {
        this.computeContours(grid, n, seq);
        ctx.save();
        const cols = ['rgba(0,240,255,0.30)', 'rgba(250,214,60,0.42)', 'rgba(255,42,84,0.75)'];
        this.contours.forEach((c, k) => {
          ctx.strokeStyle = cols[k];
          ctx.lineWidth = k === 2 ? 1.4 : 1;
          if (k === 0) ctx.setLineDash([3, 4]); else ctx.setLineDash([]);
          ctx.beginPath();
          const sg = c.segs;
          for (let i = 0; i < sg.length; i += 4) {
            ctx.moveTo(this.sx(sg[i]), this.sy(sg[i + 1]));
            ctx.lineTo(this.sx(sg[i + 2]), this.sy(sg[i + 3]));
          }
          ctx.stroke();
        });
        ctx.restore();
      }
    }

    // --- hotspots
    this.drawHotspots(hotspots, now);

    // --- trazas
    if (ui.layers.trails) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (replay) {
        const idx = Math.min(ui.replay.index, store.history.length - 1);
        const from = Math.max(0, idx - 90);
        const ids = store.history[idx].drones.map((d) => d.id);
        for (const id of ids) {
          const pts: { x: number; y: number; ir: number }[] = [];
          for (let k = from; k <= idx; k++) {
            const d = store.history[k].drones.find((q) => q.id === id);
            if (d) pts.push(d);
          }
          this.strokeTrail(pts, id === ui.selected);
        }
      } else {
        for (const [id, tr] of store.trails) this.strokeTrail(tr, id === ui.selected);
      }
      ctx.restore();
    }

    // --- predicción de comportamiento
    if (!replay && frame && ui.layers.predictions) this.drawPredictions(frame, drones);

    // --- pico de densidad
    if (!replay && frame && frame.kde.peak.v > 0.55) {
      const px = this.sx(frame.kde.peak.x), py = this.sy(frame.kde.peak.y);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,42,84,0.8)';
      ctx.lineWidth = 1;
      ctx.translate(px, py);
      ctx.rotate(now / 1400);
      for (let k = 0; k < 4; k++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(18, 0); ctx.stroke();
      }
      ctx.restore();
      if (!this.compact) {
        ctx.font = `600 9px ${MONO}`;
        ctx.fillStyle = 'rgba(255,170,185,0.9)';
        ctx.textAlign = 'left';
        ctx.fillText(`PICO KDE ${(frame.kde.peak.v * 100).toFixed(0)}%`, px + 22, py + 3);
      }
    }

    // --- drones
    this.hits = [];
    for (const d of drones) this.drawDrone(d, now, d.id === ui.selected);
  }

  private strokeTrail(tr: { x: number; y: number; ir: number }[], selected: boolean) {
    const { ctx } = this;
    if (tr.length < 2) return;
    const chunks = 10;
    const per = Math.ceil(tr.length / chunks);
    for (let c = 0; c < chunks; c++) {
      const a = c * per, b = Math.min(tr.length - 1, (c + 1) * per);
      if (b <= a) continue;
      const frac = (c + 1) / chunks;
      ctx.beginPath();
      ctx.moveTo(this.sx(tr[a].x), this.sy(tr[a].y));
      for (let i = a + 1; i <= b; i++) ctx.lineTo(this.sx(tr[i].x), this.sy(tr[i].y));
      ctx.strokeStyle = irColor(tr[b].ir, (selected ? 0.95 : 0.55) * frac * frac);
      ctx.lineWidth = selected ? 2.2 : 1.4;
      ctx.stroke();
    }
  }

  private drawPredictions(frame: Frame, drones: { id: string; x: number; y: number }[]) {
    const { ctx } = this;
    const pos = new Map(drones.map((d) => [d.id, d]));
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1.2;
    for (const p of frame.predictions) {
      const d = pos.get(p.id);
      if (!d) continue;
      ctx.beginPath();
      ctx.moveTo(this.sx(d.x), this.sy(d.y));
      for (const [x, y] of p.path) ctx.lineTo(this.sx(x), this.sy(y));
      ctx.strokeStyle = p.id === store.ui.selected ? 'rgba(192,132,252,0.95)' : 'rgba(168,85,247,0.5)';
      ctx.stroke();
      const [ex, ey] = p.path[p.path.length - 1];
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(this.sx(ex), this.sy(ey), 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(192,132,252,0.75)';
      ctx.stroke();
      ctx.setLineDash([4, 5]);
    }
    ctx.restore();
    // vector de flota
    const f = frame.fleet;
    const x1 = this.sx(f.cx), y1 = this.sy(f.cy), x2 = this.sx(f.px), y2 = this.sy(f.py);
    const len = Math.hypot(x2 - x1, y2 - y1);
    ctx.save();
    ctx.strokeStyle = VIOLET;
    ctx.fillStyle = VIOLET;
    ctx.shadowColor = VIOLET;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2;
    ctx.translate(x1, y1);
    ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-6, -6, 12, 12);
    ctx.rotate(-Math.PI / 4);
    if (len > 14) {
      const a = Math.atan2(y2 - y1, x2 - x1);
      ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(len + 4, 0); ctx.lineTo(len - 8, -6); ctx.lineTo(len - 8, 6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (!this.compact) {
      ctx.font = `600 9px ${MONO}`;
      ctx.fillStyle = 'rgba(216,180,254,0.95)';
      ctx.textAlign = 'left';
      ctx.fillText('VECTOR FLOTA +6s', x1 + 12, y1 - 10);
    }
  }

  private drawHotspots(hs: { id: string; x: number; y: number; radius: number; kind: string; intensity: number }[], now: number) {
    const { ctx } = this;
    const s = this.view.scale;
    for (const h of hs) {
      const x = this.sx(h.x), y = this.sy(h.y), r = h.radius * s;
      ctx.save();
      if (h.kind === 'fire') {
        for (let k = 0; k < 3; k++) {
          const ph = ((now / 1800 + k / 3) % 1);
          ctx.beginPath();
          ctx.arc(x, y, r * (0.4 + ph * 0.9), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,42,84,${0.55 * (1 - ph)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(255,42,84,0.7)'; ctx.lineWidth = 1; ctx.stroke();
      } else if (h.kind === 'intrusion') {
        ctx.translate(x, y);
        ctx.rotate(now / 900);
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = 1.5;
        const rr = Math.max(14, r);
        for (let k = 0; k < 4; k++) {
          ctx.beginPath(); ctx.arc(0, 0, rr, k * Math.PI / 2 + 0.2, k * Math.PI / 2 + 1.2); ctx.stroke();
        }
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      } else {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.setLineDash([1, 4]); ctx.strokeStyle = 'rgba(255,138,0,0.55)'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.restore();
      if (!this.compact || s > 0.3) {
        ctx.font = `600 9px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.fillStyle = h.kind === 'intrusion' ? AMBER : 'rgba(255,140,160,0.95)';
        const label = h.kind === 'fire' ? 'FOCO' : h.kind === 'intrusion' ? 'IR NO ID' : 'ESTRÉS HÍDRICO';
        ctx.fillText(`${label} ${h.id} +${h.intensity.toFixed(0)}°C`, x + Math.max(14, r * 0.72) + 4, y - Math.max(14, r * 0.72));
      }
    }
  }

  private drawDrone(d: { id: string; x: number; y: number; ir: number; alt: number; hrad: number; callsign?: string; thermal?: number }, now: number, selected: boolean) {
    const { ctx } = this;
    const x = this.sx(d.x), y = this.sy(d.y);
    if (x < -40 || y < -40 || x > this.w + 40 || y > this.h + 40) return;
    this.hits.push({ id: d.id, x, y });
    const ph0 = (hash(d.id) % 1000) / 1000;
    const [r, g, b] = [THERMAL_LUT[Math.round(Math.min(1, 0.36 + d.ir * 0.64) * 255) * 4], THERMAL_LUT[Math.round(Math.min(1, 0.36 + d.ir * 0.64) * 255) * 4 + 1], THERMAL_LUT[Math.round(Math.min(1, 0.36 + d.ir * 0.64) * 255) * 4 + 2]];
    const sz = this.compact ? 0.85 : 1;

    // halo IR
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glowR = (16 + d.ir * 26) * sz;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, glowR);
    grd.addColorStop(0, `rgba(${r},${g},${b},${0.55 + d.ir * 0.3})`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // anillos de pulso térmico infrarrojo
    const period = 1700 - d.ir * 700;
    for (let k = 0; k < 2; k++) {
      const ph = ((now / period + ph0 + k * 0.5) % 1);
      const rad = (7 + ph * (20 + d.ir * 22)) * sz;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - ph) * 0.75})`;
      ctx.lineWidth = 1.3;
      ctx.stroke();
    }

    // cuerpo (chevron orientado)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-d.hrad);
    ctx.beginPath();
    const L = 9 * sz;
    ctx.moveTo(L, 0); ctx.lineTo(-L * 0.7, L * 0.68); ctx.lineTo(-L * 0.3, 0); ctx.lineTo(-L * 0.7, -L * 0.68); ctx.closePath();
    ctx.fillStyle = '#E6FBFF';
    ctx.shadowColor = `rgb(${r},${g},${b})`;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgb(${r},${g},${b})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    if (selected) {
      const c = 18 * sz, l = 6;
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 1.5;
      for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(x + dx * c, y + dy * (c - l)); ctx.lineTo(x + dx * c, y + dy * c); ctx.lineTo(x + dx * (c - l), y + dy * c);
        ctx.stroke();
      }
      // línea guía + ficha
      const lx = x + 28, ly = y - 34;
      ctx.beginPath(); ctx.moveTo(x + c, y - c); ctx.lineTo(lx, ly); ctx.lineTo(lx + 8, ly);
      ctx.strokeStyle = 'rgba(0,240,255,0.7)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.font = `700 10px ${SANS}`;
      const title = `${d.id} · ${d.callsign ?? ''}`;
      const sub = `${(d.thermal ?? 0).toFixed(1)}°C  ALT ${d.alt.toFixed(0)}m`;
      ctx.font = `600 9px ${MONO}`;
      const wbox = Math.max(ctx.measureText(sub).width, 110) + 14;
      ctx.fillStyle = 'rgba(6,12,24,0.82)';
      ctx.strokeStyle = 'rgba(0,240,255,0.45)';
      ctx.beginPath(); ctx.roundRect(lx + 8, ly - 16, wbox, 32, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#E6F1FF';
      ctx.font = `700 10px ${SANS}`;
      ctx.textAlign = 'left';
      ctx.fillText(title, lx + 15, ly - 3);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.font = `600 9px ${MONO}`;
      ctx.fillText(sub, lx + 15, ly + 10);
    } else if (store.ui.layers.labels && (!this.compact || this.view.scale > 0.25)) {
      ctx.font = `600 9px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(200,225,245,0.8)';
      ctx.fillText(d.id.replace('UAV-', ''), x + 11, y - 8);
    }
  }

  // ======================================================================== RF
  private drawRF(cfg: SimConfig, frame: Frame | null, now: number) {
    const { ctx } = this;
    const s = this.view.scale;
    if (store.ui.layers.radar) this.drawRadar(cfg, now, AMBER);
    // sombra urbana
    for (const z of cfg.urban_zones) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.sx(z.x), this.sy(z.y), z.r * s, 0, Math.PI * 2);
      if (this.hatch) { ctx.fillStyle = this.hatch; ctx.fill(); }
      ctx.restore();
      if (!this.compact) {
        ctx.font = `600 9px ${MONO}`;
        ctx.fillStyle = 'rgba(255,120,140,0.75)';
        ctx.textAlign = 'center';
        ctx.fillText('ZONA URBANA DENSA · SOMBRA RF', this.sx(z.x), this.sy(z.y + z.r) - 6);
      }
    }
    // fuentes EMI
    for (const e of cfg.emi_sources) {
      const x = this.sx(e.x), y = this.sy(e.y);
      for (let k = 0; k < 3; k++) {
        const ph = (now / 2000 + k / 3) % 1;
        ctx.beginPath();
        ctx.arc(x, y, (20 + ph * 260 * e.p) * s + 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,176,32,${0.4 * (1 - ph)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,176,32,0.55)';
      ctx.beginPath();
      for (let k = 0; k < 14; k++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * 230 * s * e.p;
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        ctx.moveTo(px, py);
        ctx.lineTo(px + (Math.random() - 0.5) * 14, py + (Math.random() - 0.5) * 4);
      }
      ctx.stroke();
      ctx.fillStyle = AMBER;
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x - 5, y + 4); ctx.closePath(); ctx.fill();
      if (!this.compact) {
        ctx.font = `600 8px ${MONO}`;
        ctx.textAlign = 'left';
        ctx.fillText('EMI', x + 8, y + 3);
      }
    }
    // ruido de interferencia
    ctx.save();
    ctx.globalAlpha = 0.16;
    const pat = ctx.createPattern(this.noise, 'repeat');
    if (pat) {
      pat.setTransform(new DOMMatrix().translate(Math.random() * 160, Math.random() * 160));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.restore();

    if (!frame) return;
    const rfOnly = store.ui.mode === 'rf';
    if (rfOnly) this.hits = [];
    for (const r of frame.rf) this.drawRFTrack(r, frame.drones.find((d) => d.id === r.id), now, rfOnly);
  }

  private drawRFTrack(r: RFState, d: DroneState | undefined, now: number, hittable: boolean) {
    const { ctx } = this;
    const x = this.sx(r.x), y = this.sy(r.y);
    const blink = r.lost ? (Math.floor(now / 350) % 2 === 0 ? 1 : 0.35) : 1;
    const col = r.lost ? `rgba(255,176,32,${blink})` : 'rgba(255,214,140,0.95)';
    // elipse de incertidumbre (2σ)
    ctx.beginPath();
    ctx.arc(x, y, Math.max(6, r.sigma * 2 * this.view.scale), 0, Math.PI * 2);
    ctx.fillStyle = r.lost ? 'rgba(255,176,32,0.05)' : 'rgba(255,214,140,0.05)';
    ctx.fill();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = r.lost ? 'rgba(255,176,32,0.4)' : 'rgba(255,214,140,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 4.5, y - 4.5, 9, 9);
    if (r.lost) {
      ctx.beginPath(); ctx.moveTo(x - 4.5, y - 4.5); ctx.lineTo(x + 4.5, y + 4.5); ctx.stroke();
    }
    if (hittable) this.hits.push({ id: r.id, x, y });
    if (!this.compact || this.view.scale > 0.3) {
      ctx.font = `600 9px ${MONO}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = col;
      const txt = r.lost ? `${r.id.replace('UAV-', '')} SIN ENLACE ${(r.age_ms / 1000).toFixed(1)}s` : `${r.id.replace('UAV-', '')} Δ${(r.age_ms / 1000).toFixed(1)}s ±${r.sigma.toFixed(0)}m`;
      ctx.fillText(txt, x + 9, y - 7);
    }
    void d;
  }

  // ===================================================================== RADAR
  private drawRadar(cfg: SimConfig, now: number, color: string) {
    const { ctx } = this;
    const gx = this.sx(cfg.ground_station.x), gy = this.sy(cfg.ground_station.y);
    const R = (cfg.extent / 2) * Math.SQRT2 * this.view.scale;
    ctx.save();
    ctx.strokeStyle = color === CYAN ? 'rgba(0,240,255,0.09)' : 'rgba(255,176,32,0.10)';
    ctx.lineWidth = 1;
    ctx.font = `500 8px ${MONO}`;
    ctx.fillStyle = color === CYAN ? 'rgba(0,240,255,0.4)' : 'rgba(255,176,32,0.45)';
    ctx.textAlign = 'left';
    for (let km = 0.5; km <= 2.5; km += 0.5) {
      ctx.beginPath(); ctx.arc(gx, gy, km * 1000 * this.view.scale, 0, Math.PI * 2); ctx.stroke();
      if (km % 1 === 0) ctx.fillText(`${km.toFixed(0)} KM`, gx + km * 1000 * this.view.scale * 0.707 + 3, gy - km * 1000 * this.view.scale * 0.707);
    }
    const ang = (now / 4200) * Math.PI * 2;
    if ('createConicGradient' in ctx) {
      const g = ctx.createConicGradient(ang, gx, gy);
      const rgb = color === CYAN ? '0,240,255' : '255,176,32';
      g.addColorStop(0, `rgba(${rgb},0.16)`);
      g.addColorStop(0.08, `rgba(${rgb},0.03)`);
      g.addColorStop(0.2, `rgba(${rgb},0)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(gx, gy, R, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = color === CYAN ? 'rgba(0,240,255,0.45)' : 'rgba(255,176,32,0.45)';
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(ang) * R, gy + Math.sin(ang) * R); ctx.stroke();
    // estación terrena
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(gx, gy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(gx, gy, 8, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // =================================================================== SPLITTER
  private drawSplitter(now: number) {
    const { ctx } = this;
    const x = this.splitX;
    ctx.save();
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, 'rgba(0,240,255,0)'); g.addColorStop(0.5, 'rgba(0,240,255,0.9)'); g.addColorStop(1, 'rgba(0,240,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 1, 0, 2, this.h);
    ctx.shadowColor = CYAN;
    ctx.shadowBlur = 16;
    const cy = this.insets.top + (this.h - this.insets.top - this.insets.bottom) / 2;
    ctx.fillStyle = 'rgba(6,12,24,0.9)';
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, cy, 17, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = CYAN;
    ctx.beginPath(); ctx.moveTo(x - 10, cy); ctx.lineTo(x - 4, cy - 5); ctx.lineTo(x - 4, cy + 5); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 10, cy); ctx.lineTo(x + 4, cy - 5); ctx.lineTo(x + 4, cy + 5); ctx.closePath(); ctx.fill();
    // etiquetas de modo
    const top = this.insets.top + 14;
    const pulse = 0.75 + 0.25 * Math.sin(now / 300);
    this.chip(x - 12, top, 'RASTREO RF TRADICIONAL', AMBER, 'right', pulse);
    this.chip(x + 12, top, 'MAPA DE CALOR KDE DINÁMICO', CYAN, 'left', 1);
    ctx.restore();
  }

  private chip(x: number, y: number, text: string, color: string, align: 'left' | 'right', alpha: number) {
    const { ctx } = this;
    ctx.font = `700 ${this.compact ? 8 : 9.5}px ${MONO}`;
    const w = ctx.measureText(text).width + 18;
    const bx = align === 'left' ? x : x - w;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(6,12,24,0.85)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx, y, w, 20, 3); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, bx + 9, y + 13.5);
    ctx.globalAlpha = 1;
  }

  // ======================================================================= HUD
  private drawHUD(cfg: SimConfig, now: number, mode: string, replay: boolean) {
    const { ctx } = this;
    const L = this.insets.left, R = this.w - this.insets.right, B = this.h - this.insets.bottom, T = this.insets.top;
    // escala gráfica
    const target = 120;
    const m = [100, 200, 250, 500, 1000, 2000].find((v) => v * this.view.scale >= target * 0.6) ?? 1000;
    const px = m * this.view.scale;
    const bx = R - px - 20, by = B - 18;
    ctx.strokeStyle = 'rgba(230,241,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + px, by); ctx.lineTo(bx + px, by - 5); ctx.stroke();
    ctx.font = `600 9px ${MONO}`;
    ctx.fillStyle = 'rgba(230,241,255,0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, bx + px / 2, by - 7);

    // norte
    const nx = R - 28, ny = T + 30;
    ctx.strokeStyle = 'rgba(0,240,255,0.35)';
    ctx.beginPath(); ctx.arc(nx, ny, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = CYAN;
    ctx.beginPath(); ctx.moveTo(nx, ny - 11); ctx.lineTo(nx + 4, ny); ctx.lineTo(nx - 4, ny); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,240,255,0.3)';
    ctx.beginPath(); ctx.moveTo(nx, ny + 11); ctx.lineTo(nx + 4, ny); ctx.lineTo(nx - 4, ny); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(230,241,255,0.85)';
    ctx.font = `700 8px ${MONO}`;
    ctx.fillText('N', nx, ny - 17);

    // leyenda KDE
    if ((mode === 'kde' || mode === 'split') && !this.compact) {
      const lw = 150, lx = R - lw - 20, ly = B - 52;
      const g = ctx.createLinearGradient(lx, 0, lx + lw, 0);
      for (let i = 0; i <= 10; i++) {
        const k = Math.round(Math.max(0.2, i / 10) * 255) * 4;
        g.addColorStop(i / 10, `rgba(${THERMAL_LUT[k]},${THERMAL_LUT[k + 1]},${THERMAL_LUT[k + 2]},1)`);
      }
      ctx.fillStyle = g;
      ctx.fillRect(lx, ly, lw, 5);
      ctx.font = `600 8px ${MONO}`;
      ctx.fillStyle = 'rgba(143,163,191,0.9)';
      ctx.textAlign = 'left'; ctx.fillText('DENSIDAD KDE · FIRMA IR', lx, ly - 5);
      ctx.textAlign = 'left'; ctx.fillText('BAJA', lx, ly + 15);
      ctx.textAlign = 'right'; ctx.fillText('CRÍTICA', lx + lw, ly + 15);
    }

    if (replay) {
      const snap = store.history[Math.min(store.ui.replay.index, store.history.length - 1)];
      ctx.font = `700 11px ${MONO}`;
      ctx.fillStyle = `rgba(168,85,247,${0.7 + 0.3 * Math.sin(now / 250)})`;
      ctx.textAlign = 'center';
      ctx.fillText(`◉ REPRODUCCIÓN HISTÓRICA · T+${fmtT(snap.t)}`, L + (R - L) / 2, T + 24);
    }

    // lectura de cursor
    if (this.cursor) {
      const [wx, wy] = this.toWorld(this.cursor.x, this.cursor.y);
      const lat = cfg.origin.lat + wy / 111320;
      const lon = cfg.origin.lon + wx / (111320 * Math.cos((cfg.origin.lat * Math.PI) / 180));
      const txt = `${lat.toFixed(5)}°  ${lon.toFixed(5)}°`;
      ctx.font = `600 9px ${MONO}`;
      const w = ctx.measureText(txt).width + 12;
      const cx = this.cursor.x + 14, cy = this.cursor.y + 14;
      ctx.fillStyle = 'rgba(6,12,24,0.85)';
      ctx.strokeStyle = 'rgba(0,240,255,0.35)';
      ctx.beginPath(); ctx.roundRect(cx, cy, w, 18, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9FF8FF';
      ctx.textAlign = 'left';
      ctx.fillText(txt, cx + 6, cy + 12.5);
      ctx.strokeStyle = 'rgba(0,240,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(this.cursor.x - 8, this.cursor.y); ctx.lineTo(this.cursor.x + 8, this.cursor.y);
      ctx.moveTo(this.cursor.x, this.cursor.y - 8); ctx.lineTo(this.cursor.x, this.cursor.y + 8);
      ctx.stroke();
    }
  }
}

export function fmtT(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
