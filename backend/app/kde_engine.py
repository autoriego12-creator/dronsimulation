"""Motor KDE (Kernel Density Estimation) ponderado por firma térmica — recálculo cada 100 ms."""
from __future__ import annotations

import base64
import time
from collections import deque

import numpy as np
from scipy.ndimage import gaussian_filter

from .geo import GRID_N, HALF

BANDWIDTH_M = 115.0      # ancho de banda objetivo del kernel gaussiano
TRAIL_LEN = 60           # muestras de trayectoria por dron
TRAIL_EVERY = 3          # 1 muestra cada 3 ticks (300 ms)


class KDEEngine:
    def __init__(self, n: int = GRID_N):
        self.n = n
        axis = np.linspace(-HALF, HALF, n)
        gx, gy = np.meshgrid(axis, axis[::-1])          # fila 0 = norte
        self.positions = np.vstack([gx.ravel(), gy.ravel()])
        self.axis = axis
        self.cell = (2 * HALF) / n
        self.trails: dict[str, deque] = {}
        self.grid = np.zeros((n, n))
        self.vmax = 1e-12
        self.last_ms = 0.0
        self.peak = (0.0, 0.0, 0.0)

    def reset(self) -> None:
        self.trails.clear()
        self.grid[:] = 0
        self.vmax = 1e-12

    def update(self, drones: list[dict], tick: int) -> np.ndarray:
        t0 = time.perf_counter()
        if tick % TRAIL_EVERY == 0:
            for d in drones:
                self.trails.setdefault(d["id"], deque(maxlen=TRAIL_LEN)).append((d["x"], d["y"], d["ir"]))

        pts, w = [], []
        for d in drones:
            trail = self.trails.get(d["id"], ())
            L = len(trail)
            for k, (x, y, ir) in enumerate(trail):
                recency = 0.25 + 0.75 * (k + 1) / max(L, 1)
                pts.append((x, y))
                w.append((0.18 + ir) * recency)
            pts.append((d["x"], d["y"]))
            w.append(0.18 + d["ir"] * 1.4)

        data = np.asarray(pts, dtype=float)
        weights = np.asarray(w, dtype=float)
        if len(data) >= 3:
            # KDE binned: masa ponderada en la malla (row 0 = norte) convolucionada con kernel gaussiano.
            # Equivale a gaussian_kde con covarianza isotrópica fija, pero en O(N + G) en vez de O(N·G).
            edges = np.linspace(-HALF, HALF, self.n + 1)
            h, _, _ = np.histogram2d(data[:, 1], data[:, 0], bins=[edges, edges], weights=weights)
            z = gaussian_filter(h[::-1], sigma=BANDWIDTH_M / self.cell, mode="constant")
            self.vmax = max(float(z.max()), self.vmax * 0.994)
            self.grid = 0.55 * self.grid + 0.45 * z
        norm = np.clip(self.grid / self.vmax, 0, 1)
        j, i = np.unravel_index(int(np.argmax(norm)), norm.shape)
        self.peak = (float(self.axis[i]), float(self.axis[::-1][j]), float(norm[j, i]))
        self.last_ms = (time.perf_counter() - t0) * 1000
        return norm

    @staticmethod
    def encode(norm: np.ndarray) -> str:
        return base64.b64encode((norm * 255).astype(np.uint8).tobytes()).decode("ascii")

    def trail_points(self) -> list[tuple[float, float, float]]:
        return [p for tr in self.trails.values() for p in tr]
