# HELIOS·KDE — Simulación de Geolocalización y Monitoreo de Drones por Mapa de Calor (ID 4300)

Rastreo térmico virtual y telemetría en tiempo real. Centro de mando web + app Android de operador en campo.

```
backend/   FastAPI + WebSocket · NumPy · SciPy · Matplotlib · Folium   (pipeline 100 ms)
frontend/  React 18 + TypeScript + Vite · Canvas 2D 60 FPS · Capacitor 6 · PWA
```

## Ejecutar

```bash
pip install -r backend/requirements.txt
```

```bash
python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000
```

```bash
npm --prefix frontend install
```

```bash
npm --prefix frontend run dev
```

Abrir http://localhost:5173 — Vite hace proxy de `/api` y `/ws` al backend. Si el backend no responde,
el frontend conmuta solo al **motor local** (port TypeScript del mismo modelo) y reintenta cada 6 s.

## Android (APK)

```bash
npm --prefix frontend run cap:android
```

```bash
npm --prefix frontend run cap:open
```

En Android Studio: *Build → Build APK(s)*. En campo, la app arranca con el motor local; desde
**Mapa → Enlace con centro de mando** se apunta al backend de la LAN (p. ej. `http://192.168.1.20:8000`).
También se puede fijar al compilar con `VITE_API_URL`.

## Arquitectura del pipeline (cada 100 ms)

| Etapa | Archivo | Detalle |
|---|---|---|
| Telemetría sintética | `backend/app/simulation.py` | Cinemática con giro limitado, GNSS σ = 3.4 m, sensor IR (motor + hotspots atenuados por altitud) |
| Escenarios | `simulation.py` | Vigilancia (patrullas en malla urbana + intrusiones IR), Agrícola (barrido boustrofédico por lote + estrés hídrico), Emergencias (focos que crecen + convergencia en órbita) |
| Motor KDE | `backend/app/kde_engine.py` | KDE *binned*: histograma ponderado por firma IR × recencia + `scipy.ndimage.gaussian_filter` (h = 115 m), malla 72×72, ≈0.5 ms |
| Rastreo RF | `backend/app/rf_model.py` | Latencia 0.85–1.9 s, refresco 2 Hz, multitrayecto urbano, EMI, pérdida de enlace |
| Predicción | `backend/app/pipeline.py` | Modelo CTRV a +3 s por dron, vector de flota, error de predicción validado a posteriori |
| Alertas | `pipeline.py` | Anomalía térmica, foco crítico, intrusión, saturación KDE, pérdida RF, batería |
| Reportes | `backend/app/reports.py` | `GET /api/report/validation.png` (Matplotlib) · `GET /api/report/folium` (HeatMap + rutas) |

> Nota: se evaluó `scipy.stats.gaussian_kde` directo (≈160 ms/tick con ~600 puntos × 5184 celdas, fuera del
> presupuesto de 100 ms). El KDE binned es la aproximación estándar con kernel gaussiano isotrópico.

## API

- `WS /ws/telemetry` — `config` al conectar, luego `frame` a 10 Hz. Comandos: `{"cmd":"scenario","value":"security|agriculture|emergency"}`
- `GET /api/health` · `/api/config` · `/api/validation` · `/api/alerts` · `/api/history?drone=UAV-01`
- `POST /api/scenario/{name}`

## Datos de validación

Los 4 KPIs (94 % precisión, 1.2 s respuesta, 87 % cobertura, 98 % eficiencia) y la serie de barras apiladas
(2020, 2021, 2023, 2024; escala 0–140) son los **resultados esperados** de la especificación del proyecto,
definidos en `backend/app/reports.py` y `frontend/src/components/Validation.tsx`. Las métricas del comparador
RF vs KDE sí se calculan en vivo a partir de la simulación.
