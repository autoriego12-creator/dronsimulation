import { Check, Radio, ScanLine, SplitSquareHorizontal, X } from 'lucide-react';
import { store, useStore } from '../engine/store';
import type { TrackMode } from '../engine/types';
import { Panel, Seg } from './ui';

export const MODE_OPTIONS: { id: TrackMode; label: string; icon: React.ReactNode; title: string }[] = [
  { id: 'rf', label: 'RF', icon: <Radio size={13} />, title: 'Rastreo RF tradicional' },
  { id: 'split', label: 'Comparar', icon: <SplitSquareHorizontal size={13} />, title: 'Comparador deslizante RF vs KDE' },
  { id: 'kde', label: 'KDE', icon: <ScanLine size={13} />, title: 'Mapa de calor dinámico KDE' },
];

export function ComparatorBody() {
  const s = useStore();
  const m = s.frame?.metrics;
  if (!m) return null;
  const rows: { l: string; rf: string; kde: string; rfN: number; kdeN: number; max: number; better: 'low' | 'high' }[] = [
    { l: 'Error medio de posición', rf: `${m.rf.err.toFixed(0)} m`, kde: `${m.kde.err.toFixed(1)} m`, rfN: m.rf.err, kdeN: m.kde.err, max: Math.max(m.rf.err, 1), better: 'low' },
    { l: 'Precisión (< 8 m)', rf: `${m.rf.acc.toFixed(0)}%`, kde: `${m.kde.acc.toFixed(0)}%`, rfN: m.rf.acc, kdeN: m.kde.acc, max: 100, better: 'high' },
    { l: 'Latencia de actualización', rf: `${(m.rf.latency / 1000).toFixed(2)} s`, kde: `${(m.kde.latency / 1000).toFixed(2)} s`, rfN: m.rf.latency, kdeN: m.kde.latency, max: Math.max(m.rf.latency, 100), better: 'low' },
    { l: 'Pérdida de enlace', rf: `${m.rf.loss.toFixed(1)}%`, kde: '0.0%', rfN: m.rf.loss, kdeN: 0, max: Math.max(m.rf.loss, 1), better: 'low' },
  ];
  return (
    <>
      <div className="cmp-head">
        <span style={{ textAlign: 'left', color: 'var(--ink-3)' }}>MÉTRICA EN VIVO</span>
        <span style={{ color: 'var(--amber)' }}>RF</span>
        <span style={{ color: 'var(--cyan)' }}>KDE</span>
      </div>
      {rows.map((r) => (
        <div className="cmp-row" key={r.l}>
          <span className="cmp-row__l">{r.l}</span>
          <span className="cmp-row__v bad">{r.rf}</span>
          <span className="cmp-row__v" style={{ color: 'var(--cyan)' }}>{r.kde}</span>
          <div className="cmp-bars">
            <div className="cmp-bar"><i style={{ width: `${Math.min(100, (r.rfN / r.max) * 100)}%`, background: 'var(--amber)' }} /></div>
            <div className="cmp-bar"><i style={{ width: `${Math.min(100, (r.kdeN / r.max) * 100)}%`, background: 'var(--cyan)' }} /></div>
          </div>
        </div>
      ))}
      <div className="cmp-row">
        <span className="cmp-row__l">Patrones agregados de flota</span>
        <span className="cmp-row__v bad"><X size={14} /></span>
        <span className="cmp-row__v good"><Check size={14} /></span>
      </div>
      <div className="cmp-row">
        <span className="cmp-row__l">Predicción de trayectoria (+3 s)</span>
        <span className="cmp-row__v bad"><X size={14} /></span>
        <span className="cmp-row__v" style={{ color: 'var(--v-300)' }}>±{m.pred_err.toFixed(1)} m</span>
      </div>
      <div className="cmp-row">
        <span className="cmp-row__l">Cobertura de área (ventana 150 s)</span>
        <span className="cmp-row__v bad">—</span>
        <span className="cmp-row__v" style={{ color: 'var(--cyan)' }}>{m.coverage.toFixed(0)}%</span>
      </div>
      <ErrorTrend />
    </>
  );
}

/** Dos series (RF vs KDE) en un mismo eje — leyenda + etiquetas directas. */
function ErrorTrend() {
  const s = useStore();
  const rf = s.metricSeries.rf, kde = s.metricSeries.kde;
  const W = 300, H = 64;
  if (rf.length < 2) return null;
  const max = Math.max(...rf, ...kde, 10);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${((i / (arr.length - 1)) * W).toFixed(1)},${(H - 4 - (v / max) * (H - 10)).toFixed(1)}`).join('');
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="eyebrow">Error de posición (m) · últimos 60 s</span>
        <span className="chart-legend" style={{ fontSize: 9.5 }}>
          <span><i style={{ background: 'var(--amber)' }} />RF</span>
          <span><i style={{ background: 'var(--cyan)' }} />KDE</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H }} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((k) => <line key={k} x1="0" x2={W} y1={H * k} y2={H * k} stroke="rgba(143,163,191,0.08)" />)}
        <path d={path(rf)} fill="none" stroke="#FFB020" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={path(kde)} fill="none" stroke="#00F0FF" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function ComparatorPanel({ style }: { style?: React.CSSProperties }) {
  const s = useStore();
  return (
    <Panel code="CMP-03 · Validación cruzada" title="RF tradicional vs. KDE dinámico" style={style} bodyClass="panel__body scroll"
      meta={<Seg label="Modo de rastreo" size="sm" value={s.ui.mode} options={MODE_OPTIONS.map((o) => ({ ...o, label: '' , icon: o.icon }))} onChange={(v) => store.setUI({ mode: v })} />}>
      <ComparatorBody />
    </Panel>
  );
}
