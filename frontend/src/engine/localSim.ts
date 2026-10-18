/**
 * Motor local (port TypeScript del backend Python): se usa cuando no hay backend
 * disponible — p. ej. el APK Android en campo sin enlace al centro de mando.
 * Mismo modelo: cinemática + sensor IR + KDE binned + rastreo RF degradado.
 */
import type { Alert, DroneState, Frame, Hotspot, RFState, ScenarioId, SimConfig } from './types';

const ORIGIN = { lat: 4.6486, lon: -74.0628 };
const EXTENT = 4000;
const HALF = EXTENT / 2;
const N = 72;
const TICK = 0.1;
const SPEED = 2.5;
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const URBAN = [
  { x: -620, y: 420, r: 640 },
  { x: 720, y: -520, r: 520 },
  { x: -1150, y: -950, r: 420 },
];
const EMI = [
  { x: -450, y: 620, p: 1 },
  { x: 860, y: -300, p: 0.85 },
  { x: -1220, y: -1020, p: 0.7 },
  { x: 320, y: 1240, p: 0.55 },
];
const FIELDS: [number, number, number, number][] = [
  [-1850, 250, -250, 1800],
  [150, 350, 1850, 1800],
  [-1850, -1800, -350, -150],
  [250, -1800, 1850, -250],
];
const META: Record<ScenarioId, { label: string; n: number; cruise: number; alt: [number, number] }> = {
  security: { label: 'Vigilancia de Seguridad', n: 10, cruise: 17, alt: [90, 140] },
  agriculture: { label: 'Monitoreo Agrícola', n: 8, cruise: 11, alt: [55, 70] },
  emergency: { label: 'Gestión de Emergencias', n: 12, cruise: 27, alt: [110, 180] },
};
const PHON = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const gauss = (s: number) => {
  const u = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()) * s;
};
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const latlon = (x: number, y: number) => [ORIGIN.lat + y / M_LAT, ORIGIN.lon + x / M_LON];

function urban(x: number, y: number) {
  let f = 0;
  for (const z of URBAN) {
    const d = Math.hypot(x - z.x, y - z.y);
    if (d < z.r) f = Math.max(f, 1 - (d / z.r) ** 1.5);
  }
  return f;
}
function emi(x: number, y: number) {
  let f = 0;
  for (const e of EMI) {
    const d2 = (x - e.x) ** 2 + (y - e.y) ** 2;
    f += e.p * Math.exp(-d2 / (2 * 260 ** 2));
  }
  return Math.min(f, 1);
}

interface D {
  id: string; callsign: string; x: number; y: number; alt: number; h: number; cruise: number; talt: number;
  wps: [number, number][]; wi: number; speed: number; omega: number; battery: number; thermal: number;
  engine: number; task: string; orbit: [number, number, number] | null; odir: number;
  divUntil: number; divT: [number, number] | null; gx: number; gy: number;
}
interface HS extends Hotspot { ttl: number; growth: number }

// kernel gaussiano 1D para el KDE binned
const SIGMA = 115 / (EXTENT / N);
const KR = Math.ceil(SIGMA * 3);
const KERNEL = Array.from({ length: KR * 2 + 1 }, (_, i) => Math.exp(-((i - KR) ** 2) / (2 * SIGMA * SIGMA)));

export class LocalSim {
  t = 0;
  tick = 0;
  seq = 0;
  scenario: ScenarioId = 'security';
  drones: D[] = [];
  hs: HS[] = [];
  events: Omit<Alert, 'id' | 't' | 'lat' | 'lon'>[] = [];
  nextEvent = 25;
  hsCount = 0;
  alertCount = 0;
  cooldown = new Map<string, number>();
  trails = new Map<string, [number, number, number][]>();
  grid = new Float32Array(N * N);
  vmax = 1e-9;
  rfBuf = new Map<string, [number, number][]>();
  rfRep = new Map<string, { x: number; y: number; sigma: number; at: number; lost: boolean; latency: number }>();
  rfLoss = 0;
  predQ: [number, Map<string, [number, number]>][] = [];
  predErr = 6;
  cover = new Float32Array(40 * 40).fill(-1e9);

  constructor(s: ScenarioId = 'security') { this.reset(s); }

  config(): SimConfig {
    return {
      type: 'config', origin: ORIGIN, extent: EXTENT, grid: N, tick_ms: 100, sim_speed: SPEED,
      urban_zones: URBAN, emi_sources: EMI, ground_station: { x: 0, y: 0 }, scenario: this.scenario,
      scenarios: { security: META.security.label, agriculture: META.agriculture.label, emergency: META.emergency.label },
    };
  }

  reset(s: ScenarioId) {
    this.scenario = s;
    this.t = 0; this.tick = 0; this.hs = []; this.events = []; this.nextEvent = 25;
    this.trails.clear(); this.grid.fill(0); this.vmax = 1e-9; this.rfBuf.clear(); this.rfRep.clear();
    this.predQ = []; this.cover.fill(-1e9);
    const m = META[s];
    this.drones = Array.from({ length: m.n }, (_, i) => {
      const a = (2 * Math.PI * i) / m.n;
      return {
        id: `UAV-${String(i + 1).padStart(2, '0')}`, callsign: PHON[i % PHON.length],
        x: Math.cos(a) * 120, y: Math.sin(a) * 120, alt: 20, h: a, cruise: m.cruise * rand(0.9, 1.1),
        talt: rand(...m.alt), wps: [], wi: 0, speed: 0, omega: 0, battery: rand(72, 100), thermal: 38,
        engine: rand(36, 41), task: 'patrol', orbit: null, odir: 1, divUntil: -1, divT: null, gx: 0, gy: 0,
      };
    });
    if (s === 'security') {
      const b = 250;
      for (const d of this.drones) {
        const cx = Math.floor(rand(-6, 6)) * b, cy = Math.floor(rand(-6, 6)) * b;
        const w = Math.floor(rand(2, 5)) * b, h = Math.floor(rand(2, 5)) * b;
        let pts: [number, number][] = [[cx, cy], [cx + w, cy], [cx + w, cy + h], [cx, cy + h]];
        if (Math.random() < 0.5) pts.reverse();
        pts.splice(2, 0, [pts[1][0], cy + h / 2]);
        pts = pts.map(([x, y]) => [clamp(x, -HALF + 80, HALF - 80), clamp(y, -HALF + 80, HALF - 80)]);
        d.wps = pts;
      }
    } else if (s === 'agriculture') {
      const per = Math.max(1, Math.floor(this.drones.length / FIELDS.length));
      this.drones.forEach((d, i) => {
        const [fx0, fy0, fx1, fy1] = FIELDS[Math.floor(i / per) % FIELDS.length];
        const k = i % per, w = (fx1 - fx0) / per;
        const x0 = fx0 + k * w + 25, x1 = fx0 + (k + 1) * w - 25;
        const pts: [number, number][] = [];
        let flip = false;
        for (let y = fy0 + 30; y < fy1 - 20; y += 70) {
          pts.push(...((flip ? [[x1, y], [x0, y]] : [[x0, y], [x1, y]]) as [number, number][]));
          flip = !flip;
        }
        d.wps = [...pts, ...pts.slice().reverse()];
        d.task = 'sweep';
      });
      for (let i = 0; i < 5; i++) {
        const [fx0, fy0, fx1, fy1] = FIELDS[Math.floor(Math.random() * 4)];
        this.addHS(rand(fx0 + 150, fx1 - 150), rand(fy0 + 150, fy1 - 150), rand(16, 30), rand(110, 190), 'crop_stress');
      }
    } else {
      this.spawnFire(); this.spawnFire(); this.assign();
    }
  }

  private addHS(x: number, y: number, intensity: number, radius: number, kind: string, ttl = 1e9, growth = 0) {
    const h: HS = { id: `HS-${String(++this.hsCount).padStart(3, '0')}`, x, y, intensity, radius, kind, ttl, growth };
    this.hs.push(h);
    return h;
  }
  private spawnFire() {
    const h = this.addHS(rand(-HALF + 350, HALF - 350), rand(-HALF + 350, HALF - 350), rand(45, 60), rand(140, 210), 'fire', 1e9, rand(0.15, 0.35));
    this.events.push({ type: 'FOCUS_DETECTED', level: 'critical', x: h.x, y: h.y, drone: null, msg: `Foco crítico ${h.id} detectado — convergencia de flota iniciada` });
  }
  private assign() {
    const fires = this.hs.filter((h) => h.kind === 'fire');
    this.drones.forEach((d, i) => {
      const h = fires[i % fires.length];
      d.orbit = [h.x, h.y, h.radius * rand(0.9, 1.6) + 40];
      d.odir = i % 2 ? -1 : 1;
      d.task = 'converge';
    });
  }

  private emit(type: string, level: Alert['level'], msg: string, drone: string | null, x: number, y: number, cd: number): Alert | null {
    const key = `${type}:${drone}`;
    if (this.t - (this.cooldown.get(key) ?? -1e9) < cd) return null;
    this.cooldown.set(key, this.t);
    const [lat, lon] = latlon(x, y);
    return { id: `AL-${String(++this.alertCount).padStart(5, '0')}`, t: +this.t.toFixed(1), type, level, msg, drone, x, y, lat, lon, wall: Date.now() / 1000 };
  }

  private orbitPt(d: D, cx: number, cy: number, r: number): [number, number] {
    const a = Math.atan2(d.y - cy, d.x - cx) + d.odir * 0.45;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }
  private target(d: D): [number, number] {
    if (d.divT && this.t < d.divUntil) return this.orbitPt(d, d.divT[0], d.divT[1], 110);
    d.divT = null;
    if (d.orbit) {
      const [cx, cy, r] = d.orbit;
      if (Math.hypot(d.x - cx, d.y - cy) > r * 1.6) return [cx, cy];
      return this.orbitPt(d, cx, cy, r);
    }
    let [tx, ty] = d.wps[d.wi];
    if (Math.hypot(tx - d.x, ty - d.y) < 35) { d.wi = (d.wi + 1) % d.wps.length; [tx, ty] = d.wps[d.wi]; }
    return [tx, ty];
  }

  step(): Frame {
    const dt = TICK * SPEED;
    this.t += dt; this.tick++; this.events = [];
    if (this.t >= this.nextEvent) {
      if (this.scenario === 'security') {
        const x = rand(-HALF + 300, HALF - 300), y = rand(-HALF + 300, HALF - 300);
        const h = this.addHS(x, y, rand(30, 44), 90, 'intrusion', 55);
        const near = [...this.drones].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).slice(0, 2);
        near.forEach((d) => { d.divUntil = this.t + 45; d.divT = [x, y]; });
        this.events.push({ type: 'INTRUSION', level: 'warning', x, y, drone: null, msg: `Firma térmica no identificada ${h.id} — ${near[0].id} y ${near[1].id} desviados` });
        this.nextEvent = this.t + rand(45, 70);
      } else if (this.scenario === 'emergency') {
        if (this.hs.filter((h) => h.kind === 'fire').length < 4) { this.spawnFire(); this.assign(); }
        this.nextEvent = this.t + rand(70, 100);
      } else this.nextEvent = 1e12;
    }
    this.hs = this.hs.filter((h) => {
      h.ttl -= dt;
      if (h.growth) { h.radius = Math.min(h.radius + h.growth * dt, 420); h.intensity = Math.min(h.intensity + h.growth * 0.05 * dt, 78); }
      return h.ttl > 0;
    });

    for (const d of this.drones) {
      const [tx, ty] = this.target(d);
      const diff = wrap(Math.atan2(ty - d.y, tx - d.x) - d.h);
      const turn = clamp(diff, -0.9 * dt, 0.9 * dt);
      d.h = wrap(d.h + turn); d.omega = turn / dt;
      let ts = d.cruise * (Math.abs(diff) > 1.2 ? 0.55 : 1);
      if (d.orbit && Math.hypot(d.x - d.orbit[0], d.y - d.orbit[1]) > d.orbit[2] * 1.6) ts = d.cruise * 1.15;
      d.speed += (ts - d.speed) * Math.min(1, 0.8 * dt);
      d.x = clamp(d.x + Math.cos(d.h) * d.speed * dt, -HALF + 10, HALF - 10);
      d.y = clamp(d.y + Math.sin(d.h) * d.speed * dt, -HALF + 10, HALF - 10);
      d.alt += (d.talt - d.alt) * Math.min(1, 0.35 * dt) + gauss(0.25);
      d.battery -= dt * (0.01 + 0.0006 * d.speed);
      d.gx = d.x + gauss(3.4); d.gy = d.y + gauss(3.4);
      let env = 0;
      for (const h of this.hs) env += h.intensity * Math.exp(-((d.x - h.x) ** 2 + (d.y - h.y) ** 2) / (2 * (h.radius * 1.15) ** 2));
      const reading = d.engine + 0.12 * d.speed + env * Math.max(0.55, 1 - (d.alt - 60) / 400) + gauss(0.6);
      d.thermal += (reading - d.thermal) * Math.min(1, 1.6 * dt);
    }

    const ir = (d: D) => clamp((d.thermal - 32) / 78, 0, 1);
    const drones: DroneState[] = this.drones.map((d) => {
      const [lat, lon] = latlon(d.gx, d.gy);
      const i = ir(d);
      return {
        id: d.id, callsign: d.callsign, x: d.gx, y: d.gy, tx: d.x, ty: d.y, lat, lon, alt: d.alt, speed: d.speed,
        heading: (((90 - (d.h * 180) / Math.PI) % 360) + 360) % 360, hrad: d.h, thermal: d.thermal, ir: i,
        battery: Math.max(0, d.battery), status: i > 0.62 ? 'hot' : d.battery < 20 ? 'lowbat' : 'nominal', task: d.task,
      };
    });

    // ---- KDE binned
    const t0 = performance.now();
    if (this.tick % 3 === 0) for (const d of drones) {
      const tr = this.trails.get(d.id) ?? [];
      tr.push([d.x, d.y, d.ir]); if (tr.length > 60) tr.shift();
      this.trails.set(d.id, tr);
    }
    const mass = new Float32Array(N * N);
    const splat = (x: number, y: number, w: number) => {
      const i = Math.floor(((x + HALF) / EXTENT) * N), j = Math.floor(((HALF - y) / EXTENT) * N);
      if (i >= 0 && i < N && j >= 0 && j < N) mass[j * N + i] += w;
    };
    for (const d of drones) {
      const tr = this.trails.get(d.id) ?? [];
      tr.forEach(([x, y, i], k) => splat(x, y, (0.18 + i) * (0.25 + (0.75 * (k + 1)) / tr.length)));
      splat(d.x, d.y, 0.18 + d.ir * 1.4);
    }
    const tmp = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -KR; k <= KR; k++) { const ii = i + k; if (ii >= 0 && ii < N) s += mass[j * N + ii] * KERNEL[k + KR]; }
      tmp[j * N + i] = s;
    }
    let zmax = 0;
    const z = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -KR; k <= KR; k++) { const jj = j + k; if (jj >= 0 && jj < N) s += tmp[jj * N + i] * KERNEL[k + KR]; }
      z[j * N + i] = s; if (s > zmax) zmax = s;
    }
    this.vmax = Math.max(zmax, this.vmax * 0.994);
    const grid = new Uint8Array(N * N);
    let pv = 0, pi = 0;
    for (let k = 0; k < N * N; k++) {
      this.grid[k] = 0.55 * this.grid[k] + 0.45 * z[k];
      const v = Math.min(1, this.grid[k] / this.vmax);
      grid[k] = v * 255;
      if (v > pv) { pv = v; pi = k; }
    }
    const peak = { x: -HALF + ((pi % N) + 0.5) * (EXTENT / N), y: HALF - (Math.floor(pi / N) + 0.5) * (EXTENT / N), v: pv };
    const kdeMs = performance.now() - t0;

    // ---- RF
    const tl = this.tick * TICK;
    const rf: RFState[] = drones.map((d) => {
      const buf = this.rfBuf.get(d.id) ?? [];
      buf.push([d.tx, d.ty]); if (buf.length > 40) buf.shift();
      this.rfBuf.set(d.id, buf);
      const u = urban(d.tx, d.ty), e = emi(d.tx, d.ty);
      const latency = 0.85 + 0.55 * u + 0.35 * e + Math.random() * 0.25;
      const [lx, ly] = buf[buf.length - 1 - Math.min(buf.length - 1, Math.round(latency / TICK))];
      let rep = this.rfRep.get(d.id);
      if (!rep || tl - rep.at >= 0.5) {
        if (rep && Math.random() < 0.03 + 0.62 * u + 0.3 * e) rep.lost = true;
        else {
          const sigma = 14 + 55 * u + 30 * e;
          rep = { x: lx + gauss(sigma), y: ly + gauss(sigma), sigma, at: tl, lost: false, latency };
          this.rfRep.set(d.id, rep);
        }
      }
      return { id: d.id, x: rep.x, y: rep.y, sigma: rep.sigma, lost: rep.lost, age_ms: (tl - rep.at + rep.latency) * 1000,
        err: Math.hypot(rep.x - d.tx, rep.y - d.ty), urban: u, emi: e };
    });

    // ---- predicción CTRV
    const H = 3 * SPEED;
    const predictions = this.drones.map((d) => {
      let { x, y, h } = d;
      const path: [number, number][] = [];
      for (let k = 0; k < 6; k++) { h += d.omega * (H / 6); x += Math.cos(h) * d.speed * (H / 6); y += Math.sin(h) * d.speed * (H / 6); path.push([x, y]); }
      return { id: d.id, path };
    });
    this.predQ.push([this.tick + 30, new Map(predictions.map((p) => [p.id, p.path[5]]))]);
    while (this.predQ.length && this.predQ[0][0] <= this.tick) {
      const [, snap] = this.predQ.shift()!;
      const errs = this.drones.filter((d) => snap.has(d.id)).map((d) => Math.hypot(snap.get(d.id)![0] - d.x, snap.get(d.id)![1] - d.y));
      if (errs.length) this.predErr = 0.9 * this.predErr + 0.1 * (errs.reduce((a, b) => a + b, 0) / errs.length);
    }
    const n = this.drones.length;
    const cx = this.drones.reduce((s, d) => s + d.x, 0) / n, cy = this.drones.reduce((s, d) => s + d.y, 0) / n;
    const vx = this.drones.reduce((s, d) => s + Math.cos(d.h) * d.speed, 0) / n;
    const vy = this.drones.reduce((s, d) => s + Math.sin(d.h) * d.speed, 0) / n;

    // ---- cobertura
    for (const d of this.drones) {
      const i = Math.floor(((d.x + HALF) / EXTENT) * 40), j = Math.floor(((d.y + HALF) / EXTENT) * 40);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const ii = i + a, jj = j + b;
        if (ii >= 0 && ii < 40 && jj >= 0 && jj < 40) this.cover[jj * 40 + ii] = this.t;
      }
    }
    let cov = 0; for (const c of this.cover) if (this.t - c < 150) cov++;

    // ---- alertas
    const alerts: Alert[] = [];
    const push = (a: Alert | null) => a && alerts.push(a);
    for (const e of this.events) push(this.emit(e.type, e.level, e.msg, null, e.x, e.y, 0));
    this.drones.forEach((d, k) => {
      const i = ir(d);
      if (i > 0.72) push(this.emit('THERMAL', 'critical', `Anomalía térmica ${d.thermal.toFixed(1)} °C — firma IR ${(i * 100).toFixed(0)}%`, d.id, d.x, d.y, 45));
      else if (i > 0.5) push(this.emit('THERMAL', 'warning', `Firma térmica elevada ${d.thermal.toFixed(1)} °C`, d.id, d.x, d.y, 45));
      if (rf[k].lost && rf[k].urban > 0.35) push(this.emit('RF_LOSS', 'info', `Enlace RF degradado (multitrayecto urbano) — última posición hace ${(rf[k].age_ms / 1000).toFixed(1)} s`, d.id, d.x, d.y, 45));
      if (d.battery < 18) push(this.emit('BATTERY', 'warning', `Batería baja ${d.battery.toFixed(0)}% — relevo programado`, d.id, d.x, d.y, 60));
      if (d.battery < 9) { d.battery = 100; push(this.emit('BATTERY', 'info', 'Relevo de batería completado (hot-swap)', d.id, d.x, d.y, 5)); }
    });
    const crowd = this.drones.filter((d) => Math.hypot(d.x - peak.x, d.y - peak.y) < 380).length;
    if (pv > 0.82 && crowd >= 4) push(this.emit('SATURATION', 'warning', `Zona de saturación: ${crowd} drones en radio 380 m (densidad ${(pv * 100).toFixed(0)}%)`, null, peak.x, peak.y, 35));

    const gpsErr = drones.map((d) => Math.hypot(d.x - d.tx, d.y - d.ty));
    const rfErr = rf.map((r) => r.err);
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(a.length, 1);
    this.rfLoss = 0.95 * this.rfLoss + 0.05 * (rf.filter((r) => r.lost).length / rf.length);

    return {
      type: 'frame', seq: ++this.seq, t: this.t, wall: Date.now() / 1000, scenario: this.scenario,
      drones, rf, predictions,
      fleet: { cx, cy, vx, vy, px: cx + vx * H * 2, py: cy + vy * H * 2 },
      hotspots: this.hs.map(({ id, x, y, intensity, radius, kind }) => ({ id, x, y, intensity, radius, kind })),
      kde: { n: N, data: '', peak }, grid,
      alerts,
      metrics: {
        kde_ms: kdeMs, loop_ms: 100, coverage: (cov / 1600) * 100, saturation: pv * Math.min(1, crowd / 4), pred_err: this.predErr,
        kde: { err: mean(gpsErr), acc: (100 * gpsErr.filter((e) => e < 8).length) / gpsErr.length, latency: 100 + kdeMs },
        rf: { err: mean(rfErr), acc: (100 * rfErr.filter((e) => e < 8).length) / rfErr.length, latency: mean(rf.map((r) => r.age_ms)), loss: this.rfLoss * 100 },
      },
    };
  }
}
