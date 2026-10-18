import { useEffect, useMemo, useRef, useState } from 'react';
import { Haptics } from '@capacitor/haptics';
import { Activity, Bell, Layers, Map as MapIcon, Route, Signal, Wifi, BatteryFull, Plane } from 'lucide-react';
import { AlertList, alertIcon } from '../components/AlertsPanel';
import { ComparatorBody, MODE_OPTIONS } from '../components/ComparatorPanel';
import { FleetList, FleetSummary, TelemetryBody } from '../components/FleetPanels';
import { LinkPill, SCENARIO_OPTIONS, useUtcClock } from '../components/Header';
import { HistoryBody } from '../components/History';
import { BrandMark, Seg, fmtClock } from '../components/ui';
import { ValidationBody } from '../components/Validation';
import { irColor } from '../engine/colormap';
import { apiBase, link } from '../engine/link';
import { store, useStore, type MobileTab, type SheetSnap } from '../engine/store';
import { TacticalMap } from '../map/TacticalMap';

const TABS: { id: MobileTab; label: string; icon: React.ReactNode }[] = [
  { id: 'map', label: 'Mapa', icon: <MapIcon size={19} /> },
  { id: 'fleet', label: 'Flota', icon: <Plane size={19} /> },
  { id: 'alerts', label: 'Alertas', icon: <Bell size={19} /> },
  { id: 'analysis', label: 'Análisis', icon: <Activity size={19} /> },
  { id: 'routes', label: 'Rutas', icon: <Route size={19} /> },
];

const DOCK_H = 64;
const PEEK = 168;

export function MobileLayout({ simulated = false }: { simulated?: boolean }) {
  const s = useStore();
  const rootRef = useRef<HTMLDivElement>(null);
  const [H, setH] = useState(800);
  const [dragH, setDragH] = useState<number | null>(null);
  const top = simulated ? 34 : 8;
  const safeBottom = simulated ? 18 : 10;

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setH(e.contentRect.height));
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const snaps: Record<SheetSnap, number> = {
    peek: PEEK + DOCK_H + safeBottom,
    half: Math.round(H * 0.52),
    full: H - top - 64,
  };
  const sheetH = dragH ?? snaps[s.ui.sheet];
  const insets = useMemo(() => ({ top: top + 106, left: 0, right: 0, bottom: snaps.peek + 8 }), [top, snaps.peek]);

  // ---- arrastre del bottom sheet
  const drag = useRef<{ y0: number; h0: number } | null>(null);
  const onGrabDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y0: e.clientY, h0: sheetH };
  };
  const onGrabMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const scale = rootRef.current ? rootRef.current.getBoundingClientRect().height / H : 1;
    setDragH(Math.min(snaps.full, Math.max(snaps.peek - 40, drag.current.h0 - (e.clientY - drag.current.y0) / scale)));
  };
  const onGrabUp = () => {
    if (!drag.current) return;
    const h = dragH ?? sheetH;
    drag.current = null;
    setDragH(null);
    if (Math.abs(h - sheetH) < 4) { // toque: alternar
      store.setUI({ sheet: s.ui.sheet === 'peek' ? 'half' : s.ui.sheet === 'half' ? 'full' : 'peek' });
      return;
    }
    const best = (Object.keys(snaps) as SheetSnap[]).reduce((a, b) => (Math.abs(snaps[b] - h) < Math.abs(snaps[a] - h) ? b : a));
    store.setUI({ sheet: best });
  };

  const crit = s.alerts.filter((a) => a.level === 'critical' && s.frame && s.frame.t - a.t < 120).length;
  const pickTab = (t: MobileTab) => {
    store.setUI({ mobileTab: t, sheet: t === 'map' ? s.ui.sheet : s.ui.sheet === 'peek' ? 'half' : s.ui.sheet });
    haptic(8);
  };

  return (
    <div className="mob" ref={rootRef}>
      <TacticalMap insets={insets} compact controls="left" controlsOffset={{ top: top + 172, side: 10 }} />
      <div className="hud-overlay" />

      {simulated && <AndroidStatusBar />}

      {/* barra superior */}
      <div className="mob__bar" style={{ top }}>
        <BrandMark size={30} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, letterSpacing: '0.08em', fontSize: 13 }}>HELIOS<span style={{ color: 'var(--cyan)' }}>·KDE</span></div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            OPERADOR · {s.config?.scenarios?.[s.ui.scenario] ?? '—'} · T+{fmtClock(s.frame?.t ?? 0)}
          </div>
        </div>
        <LinkPill compact />
      </div>

      <div className="mob__modes" style={{ top: top + 62 }}>
        <Seg label="Modo de rastreo" variant="violet" size="sm" value={s.ui.mode} options={MODE_OPTIONS} onChange={(v) => { store.setUI({ mode: v }); haptic(10); }} />
      </div>
      <div className="mob__radar" style={{ top: top + 62 }}><RadarMini /></div>

      <Toasts top={top + 62} />

      {/* bottom sheet */}
      <section className={`sheet ${dragH !== null ? 'sheet--drag' : ''}`} style={{ height: sheetH }}>
        <div className="sheet__grab" onPointerDown={onGrabDown} onPointerMove={onGrabMove} onPointerUp={onGrabUp} onPointerCancel={onGrabUp}
          role="slider" aria-label="Ajustar panel inferior" aria-valuenow={sheetH}><i /></div>
        <div className="sheet__body scroll" style={{ paddingBottom: DOCK_H + safeBottom + 18 }}>
          <SheetContent tab={s.ui.mobileTab} />
        </div>
      </section>

      {/* dock translúcido */}
      <nav className="dock" style={{ bottom: safeBottom }} aria-label="Navegación principal">
        {TABS.map((t) => (
          <button key={t.id} className="dock__btn" aria-pressed={s.ui.mobileTab === t.id} onClick={() => pickTab(t.id)}>
            {t.icon}<span style={{ position: 'relative' }}>{t.label}</span>
            {t.id === 'alerts' && crit > 0 && <span className="dock__badge">{crit}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}

function SheetContent({ tab }: { tab: MobileTab }) {
  const s = useStore();
  const d = s.frame?.drones.find((q) => q.id === s.ui.selected);
  const title = (code: string, t: string) => (
    <div style={{ margin: '2px 0 10px' }}><div className="panel__code">{code}</div><div className="panel__title" style={{ fontSize: 15 }}>{t}</div></div>
  );
  switch (tab) {
    case 'map':
      return (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <div className="stat"><div className="stat__v num">{s.frame?.drones.length ?? 0}</div><div className="stat__l">Drones</div></div>
            <div className="stat"><div className="stat__v num" style={{ color: 'var(--cyan)' }}>{s.frame?.metrics.kde.err.toFixed(1) ?? '—'}<small style={{ fontSize: 10 }}> m</small></div><div className="stat__l">Error KDE</div></div>
            <div className="stat"><div className="stat__v num">{s.frame?.metrics.coverage.toFixed(0) ?? 0}%</div><div className="stat__l">Cobertura</div></div>
          </div>
          {d && (
            <button className="frow" aria-selected style={{ gridTemplateColumns: '8px 1fr auto' }} onClick={() => store.setUI({ mobileTab: 'fleet', sheet: 'half' })}>
              <span className={`dot ${d.status === 'hot' ? 'dot--crit dot--live' : ''}`} />
              <span>
                <div className="frow__id">{d.id} · {d.callsign}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--ink-3)' }}>{d.lat.toFixed(5)}, {d.lon.toFixed(5)} · {d.alt.toFixed(0)} m · {d.speed.toFixed(1)} m/s</div>
              </span>
              <span className="mono" style={{ fontSize: 15, fontWeight: 700, color: irColor(d.ir) }}>{d.thermal.toFixed(1)}°</span>
            </button>
          )}
          <div className="eyebrow">Escenario operativo</div>
          <Seg label="Escenario" value={s.ui.scenario} options={SCENARIO_OPTIONS.map((o) => ({ ...o, label: o.short }))} onChange={(v) => { link.setScenario(v); haptic(12); }} />
          <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Layers size={11} /> Capas</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {([['heat', 'Mapa de calor'], ['contours', 'Isolíneas'], ['trails', 'Trazas'], ['predictions', 'Predicción'], ['radar', 'Radar'], ['labels', 'Etiquetas']] as const).map(([k, l]) => (
              <button key={k} className="chip" aria-pressed={s.ui.layers[k]} onClick={() => store.setLayers({ [k]: !s.ui.layers[k] })}>{l}</button>
            ))}
          </div>
          <EndpointConfig />
        </div>
      );
    case 'fleet':
      return (<>{title('FLT-01 · Flota', 'Flota y telemetría')}<FleetSummary /><div style={{ margin: '12px 0' }}><TelemetryBody /></div><FleetList /></>);
    case 'alerts':
      return (<>{title('ALR-04 · Anomalías', 'Centro de alertas')}<div style={{ margin: '0 -10px' }}><AlertList /></div></>);
    case 'analysis':
      return (
        <div style={{ display: 'grid', gap: 16 }}>
          <div>{title('CMP-03 · Comparador', 'RF tradicional vs. KDE dinámico')}<ComparatorBody /></div>
          <div>{title('VAL-05 · Resultados esperados', 'Validación científica')}<ValidationBody stacked /></div>
        </div>
      );
    case 'routes':
      return (<>{title('HST-06 · Trayectorias', 'Historial reproducible')}<HistoryBody compact /></>);
  }
}

function EndpointConfig() {
  const s = useStore();
  const [v, setV] = useState(() => apiBase());
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="eyebrow">Enlace con centro de mando (FastAPI)</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="http://192.168.1.20:8000" aria-label="URL del backend"
          style={{ flex: 1, minWidth: 0, background: 'rgba(4,8,18,0.6)', border: '1px solid var(--line)', borderRadius: 10, padding: '8px 10px', color: 'var(--ink-1)', fontFamily: 'var(--font-mono)', fontSize: 11 }} />
        <button className="btn" onClick={() => link.setEndpoint(v.trim())}>Conectar</button>
      </div>
      <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)' }}>
        Estado: {s.link.source === 'backend' ? 'enlazado al backend Python' : 'motor local embebido (modo campo sin enlace)'}
      </div>
    </div>
  );
}

function Toasts({ top }: { top: number }) {
  const s = useStore();
  return (
    <div className="toasts" style={{ top: top + 112 }}>
      {s.toasts.slice(0, 2).map((t) => (
        <button key={t.id} className="toast" style={{ ['--c' as string]: t.alert.level === 'critical' ? '#FF2A54' : '#FFB020', textAlign: 'left' }}
          onClick={() => { store.dismissToast(t.id); store.focusOn(t.alert.x, t.alert.y); if (t.alert.drone) store.setUI({ selected: t.alert.drone }); }}>
          <span style={{ color: 'var(--c)' }}>{alertIcon(t.alert.type, 16)}</span>
          <span style={{ flex: 1 }}>{t.alert.msg}</span>
        </button>
      ))}
    </div>
  );
}

function AndroidStatusBar() {
  const now = useUtcClock();
  return (
    <div className="mob__status">
      <span>{now.toTimeString().slice(0, 5)}</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Signal size={13} /><Wifi size={13} /><BatteryFull size={15} /></span>
    </div>
  );
}

/** Radar compacto: área completa, barrido y contactos coloreados por firma IR. */
function RadarMini() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const S = 208;
    c.width = c.height = S;
    let raf = 0;
    const draw = (now: number) => {
      const f = store.frame, cfg = store.config;
      ctx.clearRect(0, 0, S, S);
      const R = S / 2 - 6, cx = S / 2, cy = S / 2;
      ctx.strokeStyle = 'rgba(0,240,255,0.18)';
      ctx.lineWidth = 1.5;
      for (const k of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      const a = (now / 3000) * Math.PI * 2;
      if ('createConicGradient' in ctx) {
        const g = ctx.createConicGradient(a, cx, cy);
        g.addColorStop(0, 'rgba(0,240,255,0.45)'); g.addColorStop(0.12, 'rgba(0,240,255,0.04)'); g.addColorStop(1, 'rgba(0,240,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      }
      if (f && cfg) {
        const k = R / ((cfg.extent / 2) * Math.SQRT2);
        for (const h of f.hotspots) {
          ctx.fillStyle = 'rgba(255,42,84,0.35)';
          ctx.beginPath(); ctx.arc(cx + h.x * k, cy - h.y * k, Math.max(4, h.radius * k), 0, Math.PI * 2); ctx.fill();
        }
        for (const d of f.drones) {
          const x = cx + d.x * k, y = cy - d.y * k;
          const sel = d.id === store.ui.selected;
          ctx.fillStyle = irColor(d.ir);
          ctx.shadowColor = irColor(d.ir); ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(x, y, sel ? 5 : 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke(); }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} aria-label="Radar compacto de flota" />;
}

export function haptic(ms: number) {
  Haptics.vibrate({ duration: ms }).catch(() => { /* sin motor háptico */ });
}
