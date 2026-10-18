export type ScenarioId = 'security' | 'agriculture' | 'emergency';
export type TrackMode = 'kde' | 'rf' | 'split';
export type ViewMode = 'web' | 'android' | 'auto';
export type AlertLevel = 'critical' | 'warning' | 'info';

export interface SimConfig {
  type: 'config';
  origin: { lat: number; lon: number };
  extent: number;
  grid: number;
  tick_ms: number;
  sim_speed: number;
  urban_zones: { x: number; y: number; r: number }[];
  emi_sources: { x: number; y: number; p: number }[];
  ground_station: { x: number; y: number };
  scenario: ScenarioId;
  scenarios: Record<ScenarioId, string>;
  alerts?: Alert[];
}

export interface DroneState {
  id: string;
  callsign: string;
  x: number; y: number;       // posición GPS reportada (m)
  tx: number; ty: number;     // posición verdadera (m)
  lat: number; lon: number;
  alt: number; speed: number;
  heading: number;            // grados (0 = norte, horario)
  hrad: number;               // radianes (0 = este, antihorario)
  thermal: number;            // °C
  ir: number;                 // firma IR normalizada 0..1
  battery: number;
  status: 'nominal' | 'hot' | 'lowbat';
  task: string;
}

export interface RFState {
  id: string; x: number; y: number; sigma: number; lost: boolean;
  age_ms: number; err: number; urban: number; emi: number;
}

export interface Hotspot { id: string; x: number; y: number; intensity: number; radius: number; kind: string }

export interface Alert {
  id: string; t: number; type: string; level: AlertLevel; msg: string;
  drone: string | null; x: number; y: number; lat: number; lon: number; wall?: number;
}

export interface Metrics {
  kde_ms: number; loop_ms: number; coverage: number; saturation: number; pred_err: number;
  kde: { err: number; acc: number; latency: number };
  rf: { err: number; acc: number; latency: number; loss: number };
}

export interface Frame {
  type: 'frame';
  seq: number; t: number; wall: number; scenario: ScenarioId;
  drones: DroneState[];
  rf: RFState[];
  predictions: { id: string; path: [number, number][] }[];
  fleet: { cx: number; cy: number; vx: number; vy: number; px: number; py: number };
  hotspots: Hotspot[];
  kde: { n: number; data: string; peak: { x: number; y: number; v: number } };
  alerts: Alert[];
  metrics: Metrics;
  /** grid decodificado (añadido en cliente) */
  grid?: Uint8Array;
}

export interface Snapshot {
  t: number;
  drones: { id: string; x: number; y: number; ir: number; alt: number }[];
  grid: Uint8Array;
  hotspots: Hotspot[];
}
