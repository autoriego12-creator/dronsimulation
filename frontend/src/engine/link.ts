/**
 * Enlace de telemetría: WebSocket al backend FastAPI con caída automática al
 * motor local (mismo modelo en TypeScript) y reconexión periódica.
 */
import { LocalSim } from './localSim';
import { store } from './store';
import type { Frame, ScenarioId, SimConfig } from './types';

const RETRY_MS = 6000;
const CONNECT_TIMEOUT_MS = 2200;

export function apiBase(): string {
  const q = new URLSearchParams(location.search).get('api');
  if (q) return q.replace(/\/$/, '');
  try {
    const saved = localStorage.getItem('id4300.api');
    if (saved) return saved.replace(/\/$/, '');
  } catch { /* sin almacenamiento */ }
  const env = import.meta.env.VITE_API_URL as string | undefined;
  if (env) return env.replace(/\/$/, '');
  const native = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  if (native || !location.protocol.startsWith('http')) return '';
  return location.origin;
}

class TelemetryLink {
  private ws: WebSocket | null = null;
  private local: LocalSim | null = null;
  private localTimer: number | null = null;
  private retryTimer: number | null = null;
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.startLocal();
    this.connect();
  }

  private connect() {
    const base = apiBase();
    if (!base) { this.startLocal(); return; }
    const url = base.replace(/^http/, 'ws') + '/ws/telemetry';
    store.setLink({ url: base });
    let opened = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.startLocal();
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    const timeout = window.setTimeout(() => {
      if (!opened) { ws.close(); }
    }, CONNECT_TIMEOUT_MS);
    ws.onopen = () => {
      opened = true;
      clearTimeout(timeout);
      this.stopLocal();
      this.resetForSource();
      store.setLink({ source: 'backend', hz: 0 });
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as SimConfig | Frame | { type: 'pong' };
      if (msg.type === 'config') store.ingestConfig(msg);
      else if (msg.type === 'frame') store.ingestFrame(msg);
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      if (this.ws === ws) this.ws = null;
      this.startLocal();
      this.scheduleRetry();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (!this.ws) this.connect();
    }, RETRY_MS);
  }

  private startLocal() {
    if (this.local) return;
    this.local = new LocalSim(store.ui.scenario);
    this.resetForSource();
    store.setLink({ source: 'local', hz: 0 });
    store.ingestConfig(this.local.config());
    let next = performance.now();
    const loop = () => {
      if (!this.local) return;
      store.ingestFrame(this.local.step());
      next += 100;
      const delay = next - performance.now();
      if (delay < -1000) next = performance.now();
      this.localTimer = window.setTimeout(loop, Math.max(0, delay));
    };
    loop();
  }

  /** Cada fuente numera sus alertas desde AL-00001: al cambiar de fuente se reinicia el estado. */
  private resetForSource() {
    store.config = null;
    store.alerts = [];
    store.toasts = [];
    store.resetData();
  }

  private stopLocal() {
    if (this.localTimer) clearTimeout(this.localTimer);
    this.localTimer = null;
    this.local = null;
  }

  setScenario(s: ScenarioId) {
    store.setUI({ scenario: s });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ cmd: 'scenario', value: s }));
    } else if (this.local) {
      this.local.reset(s);
      store.ingestConfig(this.local.config());
    }
  }

  /** Reapunta el enlace (p. ej. APK en campo → backend del centro de mando en la LAN). */
  setEndpoint(url: string) {
    try {
      if (url) localStorage.setItem('id4300.api', url);
      else localStorage.removeItem('id4300.api');
    } catch { /* sin almacenamiento */ }
    this.ws?.close();
    this.ws = null;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.connect();
  }
}

export const link = new TelemetryLink();
