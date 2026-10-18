"""Orquestador del pipeline en tiempo real (100 ms): simulación → KDE → RF → alertas → métricas."""
from __future__ import annotations

import math
import time
from collections import deque

import numpy as np

from .geo import GRID_N, HALF, SIM_SPEED, TICK_S, to_latlon
from .kde_engine import KDEEngine
from .rf_model import RFTracker
from .simulation import SCENARIO_META, FleetSimulation

PRED_HORIZON_REAL = 3.0                 # s reales
PRED_HORIZON_SIM = PRED_HORIZON_REAL * SIM_SPEED
COVER_N = 40                            # malla de cobertura 100 m
COVER_WINDOW = 150.0                    # s simulados


class AlertManager:
    def __init__(self):
        self.cooldown: dict[tuple, float] = {}
        self.counter = 0
        self.log: deque = deque(maxlen=300)

    def emit(self, t: float, type_: str, level: str, msg: str, drone: str | None = None,
             x: float = 0.0, y: float = 0.0, cooldown: float = 20.0) -> dict | None:
        key = (type_, drone)
        if t - self.cooldown.get(key, -1e9) < cooldown:
            return None
        self.cooldown[key] = t
        self.counter += 1
        lat, lon = to_latlon(x, y)
        a = {"id": f"AL-{self.counter:05d}", "t": round(t, 1), "type": type_, "level": level, "msg": msg,
             "drone": drone, "x": round(x, 1), "y": round(y, 1), "lat": round(lat, 6), "lon": round(lon, 6),
             "wall": time.time()}
        self.log.append(a)
        return a


class Pipeline:
    def __init__(self, scenario: str = "security"):
        self.sim = FleetSimulation(scenario)
        self.kde = KDEEngine()
        self.rf = RFTracker()
        self.alerts = AlertManager()
        self.seq = 0
        self.history: dict[str, deque] = {}
        self.pending_preds: deque = deque()
        self.pred_err = 6.0
        self.cover_last = np.full((COVER_N, COVER_N), -1e9)
        self.rf_loss_ema = 0.0
        self.metric_hist: deque = deque(maxlen=600)
        self.loop_ms = 100.0

    def set_scenario(self, scenario: str) -> None:
        self.sim.reset(scenario)
        self.kde.reset()
        self.rf.reset()
        self.history.clear()
        self.pending_preds.clear()
        self.cover_last[:] = -1e9
        self.alerts.emit(0, "SCENARIO", "info", f"Escenario activo: {SCENARIO_META[self.sim.scenario]['label']}",
                         cooldown=0)

    # ------------------------------------------------------------------
    def step(self) -> dict:
        t_real = time.time()
        t_link = self.sim.tick * TICK_S   # reloj del enlace (s reales a 10 Hz)
        sim = self.sim
        sim.step()
        drones = sim.drone_dicts()
        new_alerts: list[dict] = []

        norm = self.kde.update(drones, sim.tick)
        rf = self.rf.update(drones, t_link)

        # --- predicción de comportamiento (CTRV) y validación diferida
        preds = []
        for d in sim.drones:
            path = sim.predict(d, PRED_HORIZON_SIM)
            preds.append({"id": d.id, "path": [[round(px, 1), round(py, 1)] for px, py in path]})
        due = sim.tick + int(PRED_HORIZON_REAL / TICK_S)
        self.pending_preds.append((due, {p["id"]: p["path"][-1] for p in preds}))
        while self.pending_preds and self.pending_preds[0][0] <= sim.tick:
            _, snap = self.pending_preds.popleft()
            errs = [math.hypot(snap[d.id][0] - d.x, snap[d.id][1] - d.y) for d in sim.drones if d.id in snap]
            if errs:
                self.pred_err = 0.9 * self.pred_err + 0.1 * float(np.mean(errs))

        cx = float(np.mean([d.x for d in sim.drones]))
        cy = float(np.mean([d.y for d in sim.drones]))
        vx = float(np.mean([math.cos(d.heading) * d.speed for d in sim.drones]))
        vy = float(np.mean([math.sin(d.heading) * d.speed for d in sim.drones]))
        fleet = {"cx": round(cx, 1), "cy": round(cy, 1), "vx": round(vx, 2), "vy": round(vy, 2),
                 "px": round(cx + vx * PRED_HORIZON_SIM * 2, 1), "py": round(cy + vy * PRED_HORIZON_SIM * 2, 1)}

        # --- cobertura de área (ventana deslizante)
        for d in sim.drones:
            i = int((d.x + HALF) / (2 * HALF) * COVER_N)
            j = int((d.y + HALF) / (2 * HALF) * COVER_N)
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    ii, jj = i + di, j + dj
                    if 0 <= ii < COVER_N and 0 <= jj < COVER_N:
                        self.cover_last[jj, ii] = sim.t
        coverage = float(np.mean(sim.t - self.cover_last < COVER_WINDOW)) * 100

        # --- alertas
        for ev in sim.events:
            a = self.alerts.emit(sim.t, ev["type"], ev["level"], ev["msg"], None, ev["x"], ev["y"], cooldown=0)
            if a:
                new_alerts.append(a)
        for d, dd, r in zip(sim.drones, drones, rf):
            if d.ir > 0.72:
                a = self.alerts.emit(sim.t, "THERMAL", "critical",
                                     f"Anomalía térmica {d.thermal:.1f} °C — firma IR {d.ir * 100:.0f}%",
                                     d.id, d.x, d.y, cooldown=45)
            elif d.ir > 0.5:
                a = self.alerts.emit(sim.t, "THERMAL", "warning",
                                     f"Firma térmica elevada {d.thermal:.1f} °C", d.id, d.x, d.y, cooldown=45)
            else:
                a = None
            if a:
                new_alerts.append(a)
            if r["lost"] and r["urban"] > 0.35:
                a = self.alerts.emit(sim.t, "RF_LOSS", "info",
                                     f"Enlace RF degradado (multitrayecto urbano) — última posición hace {r['age_ms'] / 1000:.1f} s",
                                     d.id, d.x, d.y, cooldown=45)
                if a:
                    new_alerts.append(a)
            if d.battery < 18:
                a = self.alerts.emit(sim.t, "BATTERY", "warning", f"Batería baja {d.battery:.0f}% — relevo programado",
                                     d.id, d.x, d.y, cooldown=60)
                if a:
                    new_alerts.append(a)
        for d in sim.recharge_if_needed():
            a = self.alerts.emit(sim.t, "BATTERY", "info", "Relevo de batería completado (hot-swap)", d.id, d.x, d.y,
                                 cooldown=5)
            if a:
                new_alerts.append(a)

        px, py, pv = self.kde.peak
        crowd = sum(1 for d in sim.drones if math.hypot(d.x - px, d.y - py) < 380)
        saturation = pv * min(1.0, crowd / 4)
        if pv > 0.82 and crowd >= 4:
            a = self.alerts.emit(sim.t, "SATURATION", "warning",
                                 f"Zona de saturación: {crowd} drones en radio 380 m (densidad {pv * 100:.0f}%)",
                                 None, px, py, cooldown=35)
            if a:
                new_alerts.append(a)

        # --- historial de rutas (1 Hz real)
        if sim.tick % 10 == 0:
            for d in drones:
                self.history.setdefault(d["id"], deque(maxlen=900)).append(
                    (round(sim.t, 1), d["lat"], d["lon"], d["alt"], d["thermal"]))

        # --- métricas comparativas
        gps_err = [math.hypot(d["x"] - d["tx"], d["y"] - d["ty"]) for d in drones]
        rf_err = [r["err"] for r in rf]
        lost_frac = sum(r["lost"] for r in rf) / max(len(rf), 1)
        self.rf_loss_ema = 0.95 * self.rf_loss_ema + 0.05 * lost_frac
        metrics = {
            "kde_ms": round(self.kde.last_ms, 2),
            "loop_ms": round(self.loop_ms, 1),
            "coverage": round(coverage, 1),
            "saturation": round(saturation, 3),
            "pred_err": round(self.pred_err, 1),
            "kde": {"err": round(float(np.mean(gps_err)), 2),
                    "acc": round(100 * float(np.mean([e < 8 for e in gps_err])), 1),
                    "latency": round(100 + self.kde.last_ms, 1)},
            "rf": {"err": round(float(np.mean(rf_err)), 1),
                   "acc": round(100 * float(np.mean([e < 8 for e in rf_err])), 1),
                   "latency": round(float(np.mean([r["age_ms"] for r in rf])), 0),
                   "loss": round(self.rf_loss_ema * 100, 1)},
        }
        if sim.tick % 10 == 0:
            self.metric_hist.append({"t": round(sim.t, 1), **{k: v for k, v in metrics.items() if not isinstance(v, dict)},
                                     "kde_err": metrics["kde"]["err"], "rf_err": metrics["rf"]["err"]})

        self.seq += 1
        return {
            "type": "frame", "seq": self.seq, "t": round(sim.t, 2), "wall": t_real,
            "scenario": sim.scenario,
            "drones": drones, "rf": rf, "predictions": preds, "fleet": fleet,
            "hotspots": [h.to_dict() for h in sim.hotspots],
            "kde": {"n": GRID_N, "data": KDEEngine.encode(norm),
                    "peak": {"x": round(px, 1), "y": round(py, 1), "v": round(pv, 3)}},
            "alerts": new_alerts, "metrics": metrics,
        }
