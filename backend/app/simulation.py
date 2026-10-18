"""Telemetría sintética de flota: cinemática, sensores térmicos IR y 3 escenarios."""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from .geo import HALF, SIM_SPEED, TICK_S, to_latlon

SCENARIOS = ("security", "agriculture", "emergency")

SCENARIO_META = {
    "security": {"label": "Vigilancia de Seguridad", "drones": 10, "cruise": 17.0, "alt": (90, 140)},
    "agriculture": {"label": "Monitoreo Agrícola", "drones": 8, "cruise": 11.0, "alt": (55, 70)},
    "emergency": {"label": "Gestión de Emergencias", "drones": 12, "cruise": 27.0, "alt": (110, 180)},
}

# Lotes agrícolas (x0, y0, x1, y1)
FIELDS = [
    (-1850.0, 250.0, -250.0, 1800.0),
    (150.0, 350.0, 1850.0, 1800.0),
    (-1850.0, -1800.0, -350.0, -150.0),
    (250.0, -1800.0, 1850.0, -250.0),
]

PHONETIC = ["ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL",
            "INDIA", "JULIET", "KILO", "LIMA"]

GPS_SIGMA = 3.4  # m — ruido del receptor GNSS


def wrap_angle(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi


@dataclass
class Hotspot:
    id: str
    x: float
    y: float
    intensity: float      # °C sobre el ambiente en el núcleo
    radius: float         # m
    kind: str             # fire | intrusion | crop_stress
    ttl: float = 1e9      # s simulados restantes
    growth: float = 0.0

    def to_dict(self) -> dict:
        return {"id": self.id, "x": round(self.x, 1), "y": round(self.y, 1),
                "intensity": round(self.intensity, 1), "radius": round(self.radius, 1), "kind": self.kind}


@dataclass
class Drone:
    id: str
    callsign: str
    x: float
    y: float
    alt: float
    heading: float
    cruise: float
    target_alt: float
    waypoints: list[tuple[float, float]] = field(default_factory=list)
    wp_idx: int = 0
    speed: float = 0.0
    omega: float = 0.0
    battery: float = 100.0
    thermal: float = 38.0
    engine_heat: float = 38.0
    task: str = "patrol"
    orbit: tuple[float, float, float] | None = None   # (cx, cy, r)
    orbit_dir: float = 1.0
    divert_until: float = -1.0
    divert_target: tuple[float, float] | None = None
    gps_x: float = 0.0
    gps_y: float = 0.0

    @property
    def ir(self) -> float:
        """Firma infrarroja normalizada 0..1."""
        return max(0.0, min(1.0, (self.thermal - 32.0) / 78.0))


class FleetSimulation:
    def __init__(self, scenario: str = "security", seed: int | None = None):
        self.rng = random.Random(seed)
        self.t = 0.0                # tiempo simulado (s)
        self.tick = 0
        self.scenario = scenario
        self.drones: list[Drone] = []
        self.hotspots: list[Hotspot] = []
        self.events: list[dict] = []   # eventos de escenario para el centro de alertas
        self._next_event = 0.0
        self._hs_counter = 0
        self.reset(scenario)

    # ------------------------------------------------------------------ setup
    def reset(self, scenario: str) -> None:
        if scenario not in SCENARIOS:
            scenario = "security"
        self.scenario = scenario
        self.t = 0.0
        self.tick = 0
        self.hotspots = []
        self.events = []
        meta = SCENARIO_META[scenario]
        n = meta["drones"]
        self.drones = []
        for i in range(n):
            ang = 2 * math.pi * i / n
            d = Drone(
                id=f"UAV-{i + 1:02d}",
                callsign=PHONETIC[i % len(PHONETIC)],
                x=math.cos(ang) * 120, y=math.sin(ang) * 120,
                alt=20.0, heading=ang, cruise=meta["cruise"] * self.rng.uniform(0.9, 1.1),
                target_alt=self.rng.uniform(*meta["alt"]),
                engine_heat=self.rng.uniform(36.0, 41.0),
                battery=self.rng.uniform(72, 100),
            )
            self.drones.append(d)
        getattr(self, f"_setup_{scenario}")()
        self._next_event = self.t + 25.0

    def _setup_security(self) -> None:
        block = 250.0
        for d in self.drones:
            cx = self.rng.randint(-6, 5) * block
            cy = self.rng.randint(-6, 5) * block
            w = self.rng.randint(2, 4) * block
            h = self.rng.randint(2, 4) * block
            pts = [(cx, cy), (cx + w, cy), (cx + w, cy + h), (cx, cy + h)]
            if self.rng.random() < 0.5:
                pts.reverse()
            # patrulla en "L" adicional para romper simetría
            mid = (cx + w / 2, cy + h / 2)
            pts.insert(2, (pts[1][0], mid[1]))
            d.waypoints = [(min(max(px, -HALF + 80), HALF - 80), min(max(py, -HALF + 80), HALF - 80)) for px, py in pts]
            d.task = "patrol"

    def _setup_agriculture(self) -> None:
        lane = 70.0
        per_field = max(1, len(self.drones) // len(FIELDS))
        for i, d in enumerate(self.drones):
            fx0, fy0, fx1, fy1 = FIELDS[(i // per_field) % len(FIELDS)]
            k = i % per_field
            w = (fx1 - fx0) / per_field
            x0, x1 = fx0 + k * w + 25, fx0 + (k + 1) * w - 25
            pts = []
            y = fy0 + 30
            flip = False
            while y < fy1 - 20:
                pts += [(x1, y), (x0, y)] if flip else [(x0, y), (x1, y)]
                flip = not flip
                y += lane
            d.waypoints = pts + pts[::-1]
            d.task = "sweep"
        for _ in range(5):
            fx0, fy0, fx1, fy1 = self.rng.choice(FIELDS)
            self._add_hotspot(self.rng.uniform(fx0 + 150, fx1 - 150), self.rng.uniform(fy0 + 150, fy1 - 150),
                              intensity=self.rng.uniform(16, 30), radius=self.rng.uniform(110, 190), kind="crop_stress")

    def _setup_emergency(self) -> None:
        for _ in range(2):
            self._spawn_fire()
        self._assign_emergency()

    # -------------------------------------------------------------- hotspots
    def _add_hotspot(self, x, y, intensity, radius, kind, ttl=1e9, growth=0.0) -> Hotspot:
        self._hs_counter += 1
        hs = Hotspot(f"HS-{self._hs_counter:03d}", x, y, intensity, radius, kind, ttl, growth)
        self.hotspots.append(hs)
        return hs

    def _spawn_fire(self) -> Hotspot:
        x = self.rng.uniform(-HALF + 350, HALF - 350)
        y = self.rng.uniform(-HALF + 350, HALF - 350)
        hs = self._add_hotspot(x, y, intensity=self.rng.uniform(45, 60), radius=self.rng.uniform(140, 210),
                               kind="fire", growth=self.rng.uniform(0.15, 0.35))
        self.events.append({"type": "FOCUS_DETECTED", "level": "critical", "x": x, "y": y, "hotspot": hs.id,
                            "msg": f"Foco crítico {hs.id} detectado — convergencia de flota iniciada"})
        return hs

    def _assign_emergency(self) -> None:
        fires = [h for h in self.hotspots if h.kind == "fire"]
        if not fires:
            return
        for i, d in enumerate(self.drones):
            hs = fires[i % len(fires)]
            r = hs.radius * self.rng.uniform(0.9, 1.6) + 40
            d.orbit = (hs.x, hs.y, r)
            d.orbit_dir = 1.0 if i % 2 == 0 else -1.0
            d.task = "converge"

    # ------------------------------------------------------------------ step
    def step(self) -> None:
        dt = TICK_S * SIM_SPEED
        self.t += dt
        self.tick += 1
        self.events = []
        self._scenario_events()

        for hs in list(self.hotspots):
            hs.ttl -= dt
            if hs.growth:
                hs.radius = min(hs.radius + hs.growth * dt, 420)
                hs.intensity = min(hs.intensity + hs.growth * 0.05 * dt, 78)
            if hs.ttl <= 0:
                self.hotspots.remove(hs)

        for d in self.drones:
            self._move(d, dt)
            self._sense(d, dt)

    def _scenario_events(self) -> None:
        if self.t < self._next_event:
            return
        if self.scenario == "security":
            x = self.rng.uniform(-HALF + 300, HALF - 300)
            y = self.rng.uniform(-HALF + 300, HALF - 300)
            hs = self._add_hotspot(x, y, intensity=self.rng.uniform(30, 44), radius=90, kind="intrusion", ttl=55)
            near = sorted(self.drones, key=lambda d: math.hypot(d.x - x, d.y - y))[:2]
            for d in near:
                d.divert_until = self.t + 45
                d.divert_target = (x, y)
            self.events.append({"type": "INTRUSION", "level": "warning", "x": x, "y": y, "hotspot": hs.id,
                                "msg": f"Firma térmica no identificada {hs.id} — {near[0].id} y {near[1].id} desviados"})
            self._next_event = self.t + self.rng.uniform(45, 70)
        elif self.scenario == "emergency":
            if len([h for h in self.hotspots if h.kind == "fire"]) < 4:
                self._spawn_fire()
                self._assign_emergency()
            self._next_event = self.t + self.rng.uniform(70, 100)
        else:
            self._next_event = self.t + 1e9

    def _target(self, d: Drone) -> tuple[float, float]:
        if d.divert_target and self.t < d.divert_until:
            cx, cy = d.divert_target
            return self._orbit_point(d, cx, cy, 110)
        d.divert_target = None
        if d.orbit:
            cx, cy, r = d.orbit
            if math.hypot(d.x - cx, d.y - cy) > r * 1.6:
                return cx, cy
            return self._orbit_point(d, cx, cy, r)
        tx, ty = d.waypoints[d.wp_idx]
        if math.hypot(tx - d.x, ty - d.y) < 35:
            d.wp_idx = (d.wp_idx + 1) % len(d.waypoints)
            tx, ty = d.waypoints[d.wp_idx]
        return tx, ty

    def _orbit_point(self, d: Drone, cx: float, cy: float, r: float) -> tuple[float, float]:
        a = math.atan2(d.y - cy, d.x - cx) + d.orbit_dir * 0.45
        return cx + math.cos(a) * r, cy + math.sin(a) * r

    def _move(self, d: Drone, dt: float) -> None:
        tx, ty = self._target(d)
        desired = math.atan2(ty - d.y, tx - d.x)
        diff = wrap_angle(desired - d.heading)
        max_turn = 0.9 * dt
        turn = max(-max_turn, min(max_turn, diff))
        d.heading = wrap_angle(d.heading + turn)
        d.omega = turn / dt
        target_speed = d.cruise * (0.55 if abs(diff) > 1.2 else 1.0)
        if d.task == "converge" and d.orbit and math.hypot(d.x - d.orbit[0], d.y - d.orbit[1]) > d.orbit[2] * 1.6:
            target_speed = d.cruise * 1.15
        d.speed += (target_speed - d.speed) * min(1.0, 0.8 * dt)
        d.x += math.cos(d.heading) * d.speed * dt
        d.y += math.sin(d.heading) * d.speed * dt
        d.x = min(max(d.x, -HALF + 10), HALF - 10)
        d.y = min(max(d.y, -HALF + 10), HALF - 10)
        d.alt += (d.target_alt - d.alt) * min(1.0, 0.35 * dt) + self.rng.gauss(0, 0.25)
        d.battery -= dt * (0.010 + 0.0006 * d.speed)
        d.gps_x = d.x + self.rng.gauss(0, GPS_SIGMA)
        d.gps_y = d.y + self.rng.gauss(0, GPS_SIGMA)

    def _sense(self, d: Drone, dt: float) -> None:
        env = 0.0
        for hs in self.hotspots:
            dist2 = (d.x - hs.x) ** 2 + (d.y - hs.y) ** 2
            env += hs.intensity * math.exp(-dist2 / (2 * (hs.radius * 1.15) ** 2))
        alt_atten = max(0.55, 1.0 - (d.alt - 60) / 400)
        reading = d.engine_heat + 0.12 * d.speed + env * alt_atten + self.rng.gauss(0, 0.6)
        d.thermal += (reading - d.thermal) * min(1.0, 1.6 * dt)

    # --------------------------------------------------------------- export
    def predict(self, d: Drone, horizon_s: float, steps: int = 6) -> list[tuple[float, float]]:
        """Modelo de giro constante (CTRV) — horizonte en segundos simulados."""
        pts = []
        x, y, h = d.x, d.y, d.heading
        dt = horizon_s / steps
        for _ in range(steps):
            h += d.omega * dt
            x += math.cos(h) * d.speed * dt
            y += math.sin(h) * d.speed * dt
            pts.append((x, y))
        return pts

    def drone_dicts(self) -> list[dict]:
        out = []
        for d in self.drones:
            lat, lon = to_latlon(d.gps_x, d.gps_y)
            status = "nominal"
            if d.ir > 0.62:
                status = "hot"
            elif d.battery < 20:
                status = "lowbat"
            out.append({
                "id": d.id, "callsign": d.callsign,
                "x": round(d.gps_x, 2), "y": round(d.gps_y, 2),
                "tx": round(d.x, 2), "ty": round(d.y, 2),
                "lat": round(lat, 7), "lon": round(lon, 7),
                "alt": round(d.alt, 1), "speed": round(d.speed, 2),
                "heading": round((90 - math.degrees(d.heading)) % 360, 1),
                "hrad": round(d.heading, 4),
                "thermal": round(d.thermal, 2), "ir": round(d.ir, 3),
                "battery": round(max(d.battery, 0), 1), "status": status, "task": d.task,
            })
        return out

    def recharge_if_needed(self) -> list[Drone]:
        swapped = []
        for d in self.drones:
            if d.battery < 9:
                d.battery = 100.0
                swapped.append(d)
        return swapped
