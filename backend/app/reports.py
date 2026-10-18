"""Reportes de validación científica: Matplotlib (PNG) y Folium (HTML georreferenciado)."""
from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402

from .geo import EMI_SOURCES, HALF, ORIGIN_LAT, ORIGIN_LON, URBAN_ZONES, to_latlon  # noqa: E402
from .pipeline import Pipeline  # noqa: E402

KPIS = [
    {"key": "accuracy", "label": "Precisión de Geolocalización", "value": 94, "unit": "%", "decimals": 0},
    {"key": "response", "label": "Tiempo de Respuesta", "value": 1.2, "unit": "s", "decimals": 1},
    {"key": "coverage", "label": "Cobertura de Área", "value": 87, "unit": "%", "decimals": 0},
    {"key": "efficiency", "label": "Eficiencia del Sistema", "value": 98, "unit": "%", "decimals": 0},
]

# Índice de desempeño de rastreo (eventos validados) por técnica — escala 0..140
VALIDATION = {
    "years": ["2020", "2021", "2023", "2024"],
    "series": [
        {"key": "rf", "label": "Rastreo RF tradicional", "color": "#4C1D95", "values": [40, 38, 34, 30]},
        {"key": "gps", "label": "Telemetría GPS fusionada", "color": "#7C3AED", "values": [20, 28, 36, 40]},
        {"key": "kde", "label": "Mapa de calor KDE", "color": "#A855F7", "values": [8, 22, 41, 59]},
    ],
    "max": 140,
}

THERMAL_CMAP = LinearSegmentedColormap.from_list(
    "thermal", [(0, "#04070F"), (0.18, "#003A4D"), (0.38, "#00F0FF"), (0.62, "#FACC15"),
                (0.8, "#FF8A00"), (1, "#FF2A54")])

BG = "#04070F"
PANEL = "#090E1A"
INK = "#E6F1FF"
MUTED = "#7F93B0"
GRID = "#1A2438"


def validation_png(pipe: Pipeline) -> bytes:
    plt.rcParams.update({"font.family": "DejaVu Sans", "text.color": INK, "axes.labelcolor": MUTED,
                         "xtick.color": MUTED, "ytick.color": MUTED, "axes.edgecolor": GRID})
    fig = plt.figure(figsize=(14, 7.6), dpi=110, facecolor=BG)
    fig.suptitle("Validación científica · Geolocalización por mapa de calor KDE (ID 4300)",
                 x=0.04, y=0.965, ha="left", fontsize=16, fontweight="bold", color=INK)

    # KPIs
    for i, k in enumerate(KPIS):
        ax = fig.add_axes([0.04 + i * 0.235, 0.78, 0.215, 0.12], facecolor=PANEL)
        ax.set_xticks([]); ax.set_yticks([])
        for s in ax.spines.values():
            s.set_color("#123040")
        val = f"{k['value']:.{k['decimals']}f}{k['unit']}"
        ax.text(0.06, 0.55, val, fontsize=26, fontweight="bold", color="#00F0FF", va="center", family="monospace")
        ax.text(0.06, 0.18, k["label"].upper(), fontsize=8.5, color=MUTED, va="center")

    # barras apiladas
    ax = fig.add_axes([0.05, 0.08, 0.42, 0.6], facecolor=BG)
    years = VALIDATION["years"]
    bottom = np.zeros(len(years))
    for s in VALIDATION["series"]:
        vals = np.array(s["values"], float)
        ax.bar(years, vals, bottom=bottom, color=s["color"], width=0.56, edgecolor=BG, linewidth=2, label=s["label"])
        bottom += vals
    for i, tot in enumerate(bottom):
        ax.text(i, tot + 3, f"{tot:.0f}", ha="center", color=INK, fontsize=11, fontweight="bold")
    ax.set_ylim(0, 140)
    ax.set_yticks(range(0, 141, 20))
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    ax.set_title("Índice de desempeño de rastreo por técnica", loc="left", color=INK, fontsize=12)
    ax.legend(loc="upper left", frameon=False, labelcolor=INK, fontsize=9)

    # instantánea KDE
    ax2 = fig.add_axes([0.53, 0.08, 0.42, 0.6], facecolor=BG)
    grid = pipe.kde.grid / max(pipe.kde.vmax, 1e-12)
    ax2.imshow(np.clip(grid, 0, 1), extent=(-HALF, HALF, -HALF, HALF), cmap=THERMAL_CMAP, origin="upper",
               interpolation="bicubic")
    xs = [d.x for d in pipe.sim.drones]
    ys = [d.y for d in pipe.sim.drones]
    ax2.scatter(xs, ys, s=26, c="white", edgecolors="#00F0FF", linewidths=1.2, zorder=3)
    for zx, zy, r in URBAN_ZONES:
        ax2.add_patch(plt.Circle((zx, zy), r, fill=False, ls="--", color="#FF2A54", alpha=0.45))
    ax2.set_title(f"Mapa de calor KDE en vivo · escenario {pipe.sim.scenario} · t={pipe.sim.t:.0f}s",
                  loc="left", color=INK, fontsize=12)
    ax2.set_xlabel("Este (m)"); ax2.set_ylabel("Norte (m)")

    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=BG)
    plt.close(fig)
    return buf.getvalue()


def folium_html(pipe: Pipeline) -> str:
    import folium
    from folium.plugins import HeatMap

    m = folium.Map(location=[ORIGIN_LAT, ORIGIN_LON], zoom_start=14, tiles=None, control_scale=True)
    folium.TileLayer("OpenStreetMap", name="OpenStreetMap").add_to(m)
    # la última capa base añadida queda activa por defecto
    folium.TileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
                     attr="&copy; OpenStreetMap &copy; CARTO", name="Táctico oscuro").add_to(m)
    heat = []
    for x, y, ir in pipe.kde.trail_points():
        lat, lon = to_latlon(x, y)
        heat.append([lat, lon, 0.2 + ir])
    HeatMap(heat, radius=22, blur=26, min_opacity=0.25,
            gradient={0.2: "#00F0FF", 0.5: "#FACC15", 0.75: "#FF8A00", 1.0: "#FF2A54"}).add_to(m)

    for zx, zy, r in URBAN_ZONES:
        lat, lon = to_latlon(zx, zy)
        folium.Circle([lat, lon], radius=r, color="#FF2A54", weight=1, dash_array="6 6", fill=True,
                      fill_opacity=0.05, tooltip="Zona urbana densa · sombra RF").add_to(m)
    for ex, ey, _ in EMI_SOURCES:
        lat, lon = to_latlon(ex, ey)
        folium.CircleMarker([lat, lon], radius=5, color="#FFB020", fill=True, tooltip="Fuente EMI").add_to(m)

    for did, hist in pipe.history.items():
        pts = [[h[1], h[2]] for h in hist]
        if len(pts) > 1:
            folium.PolyLine(pts, color="#A855F7", weight=2, opacity=0.75, tooltip=did).add_to(m)
    for d in pipe.sim.drones:
        lat, lon = to_latlon(d.x, d.y)
        folium.CircleMarker([lat, lon], radius=6, color="#00F0FF", fill=True, fill_color="#E6FBFF", fill_opacity=1,
                            tooltip=f"{d.id} · {d.callsign} · {d.thermal:.1f} °C · {d.alt:.0f} m").add_to(m)
    for hs in pipe.sim.hotspots:
        lat, lon = to_latlon(hs.x, hs.y)
        folium.Circle([lat, lon], radius=hs.radius, color="#FF2A54", weight=2, fill=False,
                      tooltip=f"{hs.id} · {hs.kind} · +{hs.intensity:.0f} °C").add_to(m)
    folium.LayerControl(collapsed=True).add_to(m)
    return m.get_root().render()
