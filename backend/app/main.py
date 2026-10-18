"""API FastAPI + WebSocket — pipeline de telemetría térmica a 100 ms (ID 4300)."""
from __future__ import annotations

import asyncio
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from .geo import TICK_S, public_config
from .pipeline import Pipeline
from .reports import KPIS, VALIDATION, folium_html, validation_png
from .simulation import SCENARIO_META, SCENARIOS

pipe = Pipeline("security")
clients: set[WebSocket] = set()
last_frame: dict | None = None


async def run_loop() -> None:
    global last_frame
    loop = asyncio.get_running_loop()
    next_t = loop.time()
    prev = time.perf_counter()
    while True:
        now = time.perf_counter()
        pipe.loop_ms = (now - prev) * 1000
        prev = now
        frame = pipe.step()
        last_frame = frame
        if clients:
            msg = json.dumps(frame, separators=(",", ":"))
            dead = []
            for ws in list(clients):
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.append(ws)
            for ws in dead:
                clients.discard(ws)
        next_t += TICK_S
        await asyncio.sleep(max(0.0, next_t - loop.time()))
        if loop.time() - next_t > 1.0:   # tras una pausa larga, no intentar recuperar ticks
            next_t = loop.time()


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(run_loop())
    yield
    task.cancel()


app = FastAPI(title="Simulación de Geolocalización y Monitoreo de Drones · ID 4300", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def config_message() -> dict:
    return {"type": "config", **public_config(), "scenario": pipe.sim.scenario,
            "scenarios": {k: v["label"] for k, v in SCENARIO_META.items()},
            "alerts": list(pipe.alerts.log)[-60:]}


@app.get("/api/health")
def health():
    return {"ok": True, "scenario": pipe.sim.scenario, "seq": pipe.seq, "clients": len(clients),
            "kde_ms": pipe.kde.last_ms}


@app.get("/api/config")
def config():
    return config_message()


@app.post("/api/scenario/{name}")
def set_scenario(name: str):
    if name not in SCENARIOS:
        return {"ok": False, "error": "escenario desconocido"}
    pipe.set_scenario(name)
    return {"ok": True, "scenario": name}


@app.get("/api/validation")
def validation():
    return {"kpis": KPIS, "chart": VALIDATION}


@app.get("/api/alerts")
def alerts(limit: int = 100):
    return list(pipe.alerts.log)[-limit:]


@app.get("/api/history")
def history(drone: str | None = None):
    keys = ["t", "lat", "lon", "alt", "thermal"]
    data = {k: [dict(zip(keys, row)) for row in v] for k, v in pipe.history.items() if drone in (None, k)}
    return {"scenario": pipe.sim.scenario, "routes": data, "metrics": list(pipe.metric_hist)}


@app.get("/api/report/validation.png")
def report_png():
    return Response(validation_png(pipe), media_type="image/png", headers={"Cache-Control": "no-store"})


@app.get("/api/report/folium", response_class=HTMLResponse)
def report_folium():
    return HTMLResponse(folium_html(pipe), headers={"Cache-Control": "no-store"})


@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    await ws.accept()
    await ws.send_text(json.dumps(config_message()))
    clients.add(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                cmd = json.loads(raw)
            except ValueError:
                continue
            if cmd.get("cmd") == "scenario" and cmd.get("value") in SCENARIOS:
                pipe.set_scenario(cmd["value"])
                msg = json.dumps(config_message())
                for c in list(clients):
                    try:
                        await c.send_text(msg)
                    except Exception:
                        clients.discard(c)
            elif cmd.get("cmd") == "ping":
                await ws.send_text(json.dumps({"type": "pong", "id": cmd.get("id"), "wall": time.time()}))
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


# Panel web compilado (npm run build): se sirve desde la raíz para presentar con un solo proceso.
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="panel")
