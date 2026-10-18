import { useSyncExternalStore } from 'react';
import type { Alert, Frame, ScenarioId, SimConfig, Snapshot, TrackMode, ViewMode } from './types';

export type LinkSource = 'connecting' | 'backend' | 'local';
export type MobileTab = 'map' | 'fleet' | 'alerts' | 'analysis' | 'routes';
export type SheetSnap = 'peek' | 'half' | 'full';

export interface UIState {
  view: ViewMode;
  mode: TrackMode;
  scenario: ScenarioId;
  selected: string | null;
  split: number;
  layers: { heat: boolean; trails: boolean; predictions: boolean; radar: boolean; labels: boolean; contours: boolean };
  replay: { active: boolean; index: number; playing: boolean; speed: number };
  dockTab: 'validation' | 'routes';
  dockOpen: boolean;
  mobileTab: MobileTab;
  sheet: SheetSnap;
  report: null | 'folium' | 'matplotlib';
}

export interface Toast { id: string; alert: Alert; at: number }

const TRAIL_MAX = 160;
const SERIES_MAX = 120;
const HISTORY_MAX = 720;      // 6 min a 2 Hz
const ALERTS_MAX = 200;

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const loadView = (): ViewMode => {
  try {
    const v = localStorage.getItem('id4300.view');
    if (v === 'web' || v === 'android' || v === 'auto') return v;
  } catch { /* almacenamiento no disponible */ }
  return 'auto';
};

class Store {
  version = 0;
  private listeners = new Set<() => void>();

  config: SimConfig | null = null;
  frame: Frame | null = null;
  prev: Frame | null = null;
  frameAt = 0;
  prevAt = 0;
  trails = new Map<string, { x: number; y: number; ir: number }[]>();
  series = new Map<string, { alt: number[]; thermal: number[]; speed: number[] }>();
  metricSeries = { kde: [] as number[], rf: [] as number[], pred: [] as number[], cov: [] as number[] };
  alerts: Alert[] = [];
  toasts: Toast[] = [];
  history: Snapshot[] = [];
  link = { source: 'connecting' as LinkSource, hz: 0, url: '' };
  onCritical: ((a: Alert) => void) | null = null;
  focusReq: { x: number; y: number; seq: number } | null = null;

  focusOn(x: number, y: number) {
    this.focusReq = { x, y, seq: (this.focusReq?.seq ?? 0) + 1 };
  }

  ui: UIState = {
    view: loadView(),
    mode: 'kde',
    scenario: 'security',
    selected: null,
    split: 0.5,
    layers: { heat: true, trails: true, predictions: true, radar: true, labels: true, contours: true },
    replay: { active: false, index: 0, playing: false, speed: 1 },
    dockTab: 'validation',
    dockOpen: typeof window !== 'undefined' ? window.innerHeight >= 1000 : true,
    mobileTab: 'map',
    sheet: 'peek',
    report: null,
  };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  bump() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  setUI(patch: Partial<UIState>) {
    this.ui = { ...this.ui, ...patch };
    if (patch.view) {
      try { localStorage.setItem('id4300.view', patch.view); } catch { /* sin persistencia */ }
    }
    this.bump();
  }
  setLayers(patch: Partial<UIState['layers']>) {
    this.setUI({ layers: { ...this.ui.layers, ...patch } });
  }
  setReplay(patch: Partial<UIState['replay']>) {
    this.setUI({ replay: { ...this.ui.replay, ...patch } });
  }
  setLink(patch: Partial<Store['link']>) {
    this.link = { ...this.link, ...patch };
    this.bump();
  }

  resetData() {
    this.frame = this.prev = null;
    this.trails.clear();
    this.series.clear();
    this.history = [];
    this.metricSeries = { kde: [], rf: [], pred: [], cov: [] };
    this.ui = { ...this.ui, replay: { active: false, index: 0, playing: false, speed: 1 } };
  }

  ingestConfig(cfg: SimConfig) {
    const changed = !this.config || this.config.scenario !== cfg.scenario;
    this.config = cfg;
    if (changed) this.resetData();
    if (cfg.alerts?.length && this.alerts.length === 0) this.alerts = [...cfg.alerts].reverse();
    this.ui = { ...this.ui, scenario: cfg.scenario };
    this.bump();
  }

  ingestFrame(f: Frame) {
    if (!f.grid) f.grid = decode(f.kde.data);
    if (this.config && f.scenario !== this.config.scenario) {
      this.config = { ...this.config, scenario: f.scenario };
      this.resetData();
      this.ui = { ...this.ui, scenario: f.scenario };
    }
    const now = performance.now();
    if (this.frameAt) {
      const hz = 1000 / Math.max(1, now - this.frameAt);
      this.link.hz = this.link.hz ? this.link.hz * 0.9 + hz * 0.1 : hz;
    }
    this.prev = this.frame;
    this.prevAt = this.frameAt;
    this.frame = f;
    this.frameAt = now;

    const sampleTrail = f.seq % 2 === 0;
    for (const d of f.drones) {
      if (sampleTrail) {
        const tr = this.trails.get(d.id) ?? [];
        tr.push({ x: d.x, y: d.y, ir: d.ir });
        if (tr.length > TRAIL_MAX) tr.shift();
        this.trails.set(d.id, tr);
      }
      if (f.seq % 3 === 0) {
        const s = this.series.get(d.id) ?? { alt: [], thermal: [], speed: [] };
        s.alt.push(d.alt); s.thermal.push(d.thermal); s.speed.push(d.speed);
        if (s.alt.length > SERIES_MAX) { s.alt.shift(); s.thermal.shift(); s.speed.shift(); }
        this.series.set(d.id, s);
      }
    }
    if (f.seq % 5 === 0) {
      const ms = this.metricSeries;
      ms.kde.push(f.metrics.kde.err); ms.rf.push(f.metrics.rf.err);
      ms.pred.push(f.metrics.pred_err); ms.cov.push(f.metrics.coverage);
      for (const k of ['kde', 'rf', 'pred', 'cov'] as const) if (ms[k].length > SERIES_MAX) ms[k].shift();
      this.history.push({
        t: f.t,
        drones: f.drones.map((d) => ({ id: d.id, x: d.x, y: d.y, ir: d.ir, alt: d.alt })),
        grid: f.grid,
        hotspots: f.hotspots,
      });
      if (this.history.length > HISTORY_MAX) {
        this.history.shift();
        if (this.ui.replay.active) this.ui.replay.index = Math.max(0, this.ui.replay.index - 1);
      }
    }
    const known = new Set(this.alerts.map((a) => a.id));
    const fresh = f.alerts.filter((a) => !known.has(a.id));
    if (fresh.length) {
      this.alerts = [...[...fresh].reverse(), ...this.alerts].slice(0, ALERTS_MAX);
      for (const a of fresh) {
        if (a.level === 'critical' || a.level === 'warning') {
          this.toasts = [{ id: a.id, alert: a, at: now }, ...this.toasts].slice(0, 3);
          if (a.level === 'critical') this.onCritical?.(a);
        }
      }
    }
    this.toasts = this.toasts.filter((t) => now - t.at < 6000);
    if (!this.ui.selected && f.drones.length) this.ui = { ...this.ui, selected: f.drones[0].id };
    this.bump();
  }

  dismissToast(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.bump();
  }
}

export const store = new Store();

/** Re-render a la cadencia del pipeline (10 Hz) o ante cambios de UI. */
export function useStore() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

if (import.meta.env.DEV) (window as unknown as { __store: Store }).__store = store;
