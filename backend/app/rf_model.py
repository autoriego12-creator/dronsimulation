"""Modelo de rastreo RF tradicional: latencia, multitrayecto urbano, interferencia y pérdida de enlace."""
from __future__ import annotations

import math
import random
from collections import deque

from .geo import TICK_S, emi_factor, urban_factor


class RFTracker:
    def __init__(self, seed: int | None = None):
        self.rng = random.Random(seed)
        self.buffers: dict[str, deque] = {}
        self.reported: dict[str, dict] = {}

    def reset(self) -> None:
        self.buffers.clear()
        self.reported.clear()

    def update(self, drones: list[dict], t_real: float) -> list[dict]:
        out = []
        for d in drones:
            buf = self.buffers.setdefault(d["id"], deque(maxlen=40))
            buf.append((d["tx"], d["ty"]))
            u = urban_factor(d["tx"], d["ty"])
            e = emi_factor(d["tx"], d["ty"])
            latency = 0.85 + 0.55 * u + 0.35 * e + self.rng.uniform(0, 0.25)   # s
            lag = min(len(buf) - 1, int(round(latency / TICK_S)))
            lx, ly = buf[-1 - lag]
            p_loss = 0.03 + 0.62 * u + 0.30 * e
            rep = self.reported.get(d["id"])
            # el receptor RF refresca a ~2 Hz, no a 10 Hz
            refresh = rep is None or (t_real - rep["at"]) >= 0.5
            if refresh:
                if rep is not None and self.rng.random() < p_loss:
                    rep["lost"] = True
                else:
                    sigma = 14 + 55 * u + 30 * e
                    rep = {"x": lx + self.rng.gauss(0, sigma), "y": ly + self.rng.gauss(0, sigma),
                           "sigma": sigma, "at": t_real, "lost": False, "latency": latency}
                    self.reported[d["id"]] = rep
            err = math.hypot(rep["x"] - d["tx"], rep["y"] - d["ty"])
            out.append({
                "id": d["id"], "x": round(rep["x"], 1), "y": round(rep["y"], 1),
                "sigma": round(rep["sigma"], 1), "lost": rep["lost"],
                "age_ms": int((t_real - rep["at"]) * 1000 + rep["latency"] * 1000),
                "err": round(err, 1), "urban": round(u, 2), "emi": round(e, 2),
            })
        return out
