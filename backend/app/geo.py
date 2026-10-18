"""Marco georreferenciado compartido por la simulación, el motor KDE y los reportes.

Coordenadas locales en metros (x = Este, y = Norte) centradas en el origen.
El área de operación es un cuadrado de EXTENT metros sobre Bogotá (Chapinero).
"""
from __future__ import annotations

import math

ORIGIN_LAT = 4.6486
ORIGIN_LON = -74.0628
EXTENT = 4000.0
HALF = EXTENT / 2.0

M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(ORIGIN_LAT))

TICK_S = 0.1          # periodo del pipeline (100 ms)
SIM_SPEED = 2.5       # segundos simulados por segundo real
GRID_N = 72           # resolución de la malla KDE (72 x 72 ≈ 55 m por celda)

# Zonas urbanas densas: (x, y, radio) — sombra RF / multitrayecto
URBAN_ZONES = [
    (-620.0, 420.0, 640.0),
    (720.0, -520.0, 520.0),
    (-1150.0, -950.0, 420.0),
]

# Fuentes de interferencia electromagnética: (x, y, potencia relativa)
EMI_SOURCES = [
    (-450.0, 620.0, 1.0),
    (860.0, -300.0, 0.85),
    (-1220.0, -1020.0, 0.7),
    (320.0, 1240.0, 0.55),
]

GROUND_STATION = (0.0, 0.0)


def to_latlon(x: float, y: float) -> tuple[float, float]:
    return ORIGIN_LAT + y / M_PER_DEG_LAT, ORIGIN_LON + x / M_PER_DEG_LON


def urban_factor(x: float, y: float) -> float:
    """0 en campo abierto, 1 en el núcleo de una zona urbana densa."""
    f = 0.0
    for zx, zy, r in URBAN_ZONES:
        d = math.hypot(x - zx, y - zy)
        if d < r:
            f = max(f, 1.0 - (d / r) ** 1.5)
    return f


def emi_factor(x: float, y: float) -> float:
    f = 0.0
    for ex, ey, p in EMI_SOURCES:
        d = math.hypot(x - ex, y - ey)
        f += p * math.exp(-(d * d) / (2 * 260.0 ** 2))
    return min(f, 1.0)


def public_config() -> dict:
    return {
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
        "extent": EXTENT,
        "grid": GRID_N,
        "tick_ms": int(TICK_S * 1000),
        "sim_speed": SIM_SPEED,
        "urban_zones": [{"x": x, "y": y, "r": r} for x, y, r in URBAN_ZONES],
        "emi_sources": [{"x": x, "y": y, "p": p} for x, y, p in EMI_SOURCES],
        "ground_station": {"x": GROUND_STATION[0], "y": GROUND_STATION[1]},
    }
