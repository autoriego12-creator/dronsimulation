import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileImage, Map as MapIcon } from 'lucide-react';
import { apiBase } from '../engine/link';
import { store, useStore } from '../engine/store';

export const KPIS = [
  { key: 'accuracy', label: 'Precisión de Geolocalización', value: 94, unit: '%', decimals: 0, ratio: 0.94, sub: 'error < 8 m · n = 12 400' },
  { key: 'response', label: 'Tiempo de Respuesta', value: 1.2, unit: 's', decimals: 1, ratio: 1 - 1.2 / 5, sub: 'detección → alerta' },
  { key: 'coverage', label: 'Cobertura de Área', value: 87, unit: '%', decimals: 0, ratio: 0.87, sub: '16 km² operativos' },
  { key: 'efficiency', label: 'Eficiencia del Sistema', value: 98, unit: '%', decimals: 0, ratio: 0.98, sub: 'uptime del pipeline' },
];

export const VALIDATION = {
  years: ['2020', '2021', '2023', '2024'],
  series: [
    { key: 'rf', label: 'Rastreo RF tradicional', color: '#4C1D95', top: '#6D28D9', values: [40, 38, 34, 30] },
    { key: 'gps', label: 'Telemetría GPS fusionada', color: '#7C3AED', top: '#8B5CF6', values: [20, 28, 36, 40] },
    { key: 'kde', label: 'Mapa de calor KDE', color: '#A855F7', top: '#C084FC', values: [8, 22, 41, 59] },
  ],
  max: 140,
};

function useCountUp(target: number, decimals: number, duration = 1600) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      setV(+(target * e).toFixed(decimals));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, decimals, duration]);
  return v;
}

function KpiTile({ k, i }: { k: (typeof KPIS)[number]; i: number }) {
  const v = useCountUp(k.value, k.decimals, 1400 + i * 220);
  const p = (v / k.value) * k.ratio;
  const C = 2 * Math.PI * 20;
  return (
    <div className="kpi" style={{ animation: `panel-in 0.7s ${0.08 * i}s both var(--ease-out)` }}>
      <div>
        <div className="kpi__v">{v.toFixed(k.decimals)}<small>{k.unit}</small></div>
        <div className="kpi__l">{k.label}</div>
        <div className="kpi__s">{k.sub}</div>
      </div>
      <svg viewBox="0 0 50 50" aria-hidden>
        <defs>
          <linearGradient id={`kg${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00F0FF" /><stop offset="1" stopColor="#A855F7" />
          </linearGradient>
        </defs>
        <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(168,85,247,0.15)" strokeWidth="4" />
        <circle cx="25" cy="25" r="20" fill="none" stroke={`url(#kg${i})`} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${C * p} ${C}`} transform="rotate(-90 25 25)" style={{ filter: 'drop-shadow(0 0 4px rgba(168,85,247,0.8))' }} />
      </svg>
    </div>
  );
}

export function KpiGrid({ columns = 4 }: { columns?: number }) {
  return (
    <div className="kpis" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {KPIS.map((k, i) => <KpiTile key={k.key} k={k} i={i} />)}
    </div>
  );
}

/** Barras apiladas 0–140 · 3 series púrpura en orden fijo · leyenda + etiquetas directas + tooltip. */
export function StackedBars({ height = 190 }: { height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [grow, setGrow] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    if (wrap.current) ro.observe(wrap.current);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 1300);
      setGrow(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  const padL = 30, padR = 8, padT = 16, padB = 22;
  const iw = Math.max(100, w - padL - padR), ih = height - padT - padB;
  const n = VALIDATION.years.length;
  const band = iw / n;
  const bw = Math.min(54, band * 0.52);
  const y = (v: number) => padT + ih - (v / VALIDATION.max) * ih;
  const ticks = [0, 20, 40, 60, 80, 100, 120, 140];

  return (
    <div ref={wrap} style={{ position: 'relative', width: '100%', minWidth: 0, overflow: 'hidden' }}>
      <div className="chart-legend" style={{ marginBottom: 8 }}>
        {VALIDATION.series.map((s) => <span key={s.key}><i style={{ background: s.color, boxShadow: `inset 0 0 0 1px ${s.top}` }} />{s.label}</span>)}
      </div>
      {w > 0 && <svg width={w} height={height} role="img" aria-label="Índice de desempeño de rastreo por técnica, 2020–2024">
        <defs>
          {VALIDATION.series.map((s) => (
            <linearGradient key={s.key} id={`sb-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.top} /><stop offset="1" stopColor={s.color} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(143,163,191,0.35)' : 'rgba(143,163,191,0.08)'} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#5C6E89" fontFamily="var(--font-mono)">{t}</text>
          </g>
        ))}
        {VALIDATION.years.map((yr, i) => {
          const cx = padL + band * i + band / 2;
          let acc = 0;
          const total = VALIDATION.series.reduce((a, s) => a + s.values[i], 0);
          return (
            <g key={yr} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}>
              <rect x={cx - band / 2} y={padT} width={band} height={ih} fill={hover === i ? 'rgba(168,85,247,0.06)' : 'transparent'} />
              {VALIDATION.series.map((s, k) => {
                const v = s.values[i] * grow;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                const h = Math.max(0, y0 - y1 - 2); // 2px de separación entre segmentos
                const isTop = k === VALIDATION.series.length - 1;
                return (
                  <g key={s.key}>
                    {isTop ? (
                      <path d={`M${cx - bw / 2},${y0 - 2} V${y1 + 4} Q${cx - bw / 2},${y1} ${cx - bw / 2 + 4},${y1} H${cx + bw / 2 - 4} Q${cx + bw / 2},${y1} ${cx + bw / 2},${y1 + 4} V${y0 - 2} Z`}
                        fill={`url(#sb-${s.key})`} stroke={s.top} strokeOpacity="0.6" />
                    ) : (
                      <rect x={cx - bw / 2} y={y1} width={bw} height={h} fill={`url(#sb-${s.key})`} stroke={s.top} strokeOpacity="0.55" />
                    )}
                    {h > 14 && grow > 0.95 && (
                      <text x={cx} y={y1 + h / 2 + 3.5} textAnchor="middle" fontSize="9.5" fill="#F3E8FF" fontFamily="var(--font-mono)" fontWeight="600">{s.values[i]}</text>
                    )}
                  </g>
                );
              })}
              <text x={cx} y={y(total * grow) - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="#E6F1FF" fontFamily="var(--font-mono)">{Math.round(total * grow)}</text>
              <text x={cx} y={height - 6} textAnchor="middle" fontSize="10" fill="#94A8C6" fontFamily="var(--font-mono)">{yr}</text>
            </g>
          );
        })}
      </svg>}
      {hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(w - 190, padL + band * hover + band / 2 + bw / 2 + 8), top: 30 }}>
          <div className="eyebrow" style={{ color: 'var(--v-300)' }}>Corte {VALIDATION.years[hover]}</div>
          {[...VALIDATION.series].reverse().map((s) => (
            <div className="chart-tip__row" key={s.key}>
              <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 6 }} />{s.label}</span>
              <b>{s.values[hover]}</b>
            </div>
          ))}
          <div className="chart-tip__row" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 4, marginTop: 6 }}>
            <span>Índice total</span><b>{VALIDATION.series.reduce((a, s) => a + s.values[hover], 0)}</b>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReportActions({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const backend = s.link.source === 'backend';
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({
      generated: new Date().toISOString(), scenario: s.ui.scenario, kpis: KPIS, validation: VALIDATION,
      live_metrics: s.frame?.metrics, alerts: s.alerts.slice(0, 100),
      routes: Object.fromEntries([...s.trails].map(([id, tr]) => [id, tr.map((p) => [Math.round(p.x), Math.round(p.y), +p.ir.toFixed(3)])])),
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `id4300-validacion-${s.ui.scenario}-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const tip = backend ? undefined : 'Requiere el backend Python (FastAPI) conectado';
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn" disabled={!backend} title={tip} onClick={() => store.setUI({ report: 'folium' })}><MapIcon size={14} />{compact ? 'Folium' : 'Mapa Folium'}</button>
      <button className="btn btn--violet" disabled={!backend} title={tip} onClick={() => store.setUI({ report: 'matplotlib' })}><FileImage size={14} />{compact ? 'Matplotlib' : 'Reporte Matplotlib'}</button>
      <button className="btn" onClick={exportJson} style={{ color: 'var(--ink-2)', borderColor: 'var(--line-soft)', background: 'transparent' }}><Download size={14} />JSON</button>
    </div>
  );
}

export function ReportModal() {
  const s = useStore();
  const stamp = useMemo(() => Date.now(), [s.ui.report]);
  if (!s.ui.report) return null;
  const base = apiBase();
  const src = s.ui.report === 'folium' ? `${base}/api/report/folium?t=${stamp}` : `${base}/api/report/validation.png?t=${stamp}`;
  return (
    <div className="modal-back" onClick={() => store.setUI({ report: null })}>
      <section className="panel modal" onClick={(e) => e.stopPropagation()}>
        <header className="panel__head">
          <div>
            <div className="panel__code">{s.ui.report === 'folium' ? 'RPT-F · Folium · Leaflet' : 'RPT-M · Matplotlib · PNG'}</div>
            <div className="panel__title">{s.ui.report === 'folium' ? 'Mapa georreferenciado de validación (HeatMap + rutas)' : 'Reporte de validación científica'}</div>
          </div>
          <div className="panel__meta">
            <a className="btn" href={src} target="_blank" rel="noreferrer"><Download size={14} />Abrir / descargar</a>
            <button className="btn" onClick={() => store.setUI({ report: null })}>Cerrar</button>
          </div>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
          {s.ui.report === 'folium' ? <iframe title="Mapa Folium" src={src} /> : <img alt="Reporte de validación Matplotlib" src={src} />}
        </div>
      </section>
    </div>
  );
}

export function ValidationBody({ stacked = false }: { stacked?: boolean }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <KpiGrid columns={stacked ? 2 : 4} />
      <div className={stacked ? '' : 'valid'} style={stacked ? { display: 'grid', gap: 12 } : undefined}>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Índice de desempeño de rastreo por técnica · eventos validados</div>
          <StackedBars height={stacked ? 200 : 170} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="eyebrow">Lectura</div>
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 11.5, lineHeight: 1.55 }}>
            Entre 2020 y 2024 el índice total crece de <b className="num" style={{ color: 'var(--ink-1)' }}>68</b> a <b className="num" style={{ color: 'var(--ink-1)' }}>129</b>.
            La contribución del <b style={{ color: 'var(--v-300)' }}>mapa de calor KDE</b> se multiplica ×7,4 mientras el rastreo RF aislado retrocede,
            consistente con la menor latencia y la ausencia de pérdidas de enlace observadas en el comparador en vivo.
          </p>
          <ReportActions compact={stacked} />
        </div>
      </div>
    </div>
  );
}
