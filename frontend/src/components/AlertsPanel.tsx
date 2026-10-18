import { useState } from 'react';
import { BatteryWarning, Flame, Info, Layers, RadioTower, ShieldAlert, Siren } from 'lucide-react';
import { store, useStore } from '../engine/store';
import type { Alert } from '../engine/types';
import { Panel, fmtClock } from './ui';

const LEVEL_COLOR: Record<Alert['level'], string> = { critical: '#FF2A54', warning: '#FFB020', info: '#00F0FF' };
const LEVEL_LABEL: Record<Alert['level'], string> = { critical: 'CRÍTICA', warning: 'AVISO', info: 'INFO' };

export function alertIcon(type: string, size = 14) {
  switch (type) {
    case 'THERMAL': return <Flame size={size} />;
    case 'FOCUS_DETECTED': return <Siren size={size} />;
    case 'INTRUSION': return <ShieldAlert size={size} />;
    case 'SATURATION': return <Layers size={size} />;
    case 'RF_LOSS': return <RadioTower size={size} />;
    case 'BATTERY': return <BatteryWarning size={size} />;
    default: return <Info size={size} />;
  }
}

type Filter = 'all' | 'critical' | 'thermal' | 'saturation' | 'rf';
const FILTERS: { id: Filter; label: string; match: (a: Alert) => boolean }[] = [
  { id: 'all', label: 'Todas', match: () => true },
  { id: 'critical', label: 'Críticas', match: (a) => a.level === 'critical' },
  { id: 'thermal', label: 'Térmicas', match: (a) => ['THERMAL', 'FOCUS_DETECTED', 'INTRUSION'].includes(a.type) },
  { id: 'saturation', label: 'Saturación', match: (a) => a.type === 'SATURATION' },
  { id: 'rf', label: 'RF', match: (a) => a.type === 'RF_LOSS' },
];

export function AlertList({ limit = 60, onPick }: { limit?: number; onPick?: () => void }) {
  const s = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const f = FILTERS.find((x) => x.id === filter)!;
  const list = s.alerts.filter(f.match).slice(0, limit);
  return (
    <>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '10px 10px 0' }}>
        {FILTERS.map((x) => (
          <button key={x.id} className="chip" aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}>
            {x.label}
            <span className="mono" style={{ opacity: 0.6 }}>{s.alerts.filter(x.match).length}</span>
          </button>
        ))}
      </div>
      <div className="alerts">
        {list.length === 0 && <div className="eyebrow" style={{ padding: 12 }}>Sin eventos en esta categoría</div>}
        {list.map((a) => (
          <button key={a.id} className="alert" style={{ ['--c' as string]: LEVEL_COLOR[a.level] }}
            onClick={() => { if (a.drone) store.setUI({ selected: a.drone }); store.focusOn(a.x, a.y); onPick?.(); }}>
            <span className="alert__ic">{alertIcon(a.type)}</span>
            <span>
              <div className="alert__msg">{a.msg}</div>
              <div className="alert__meta">
                <span className="alert__lvl">{LEVEL_LABEL[a.level]}</span>
                <span>T+{fmtClock(a.t)}</span>
                {a.drone && <span>{a.drone}</span>}
                <span>{a.lat.toFixed(4)}, {a.lon.toFixed(4)}</span>
              </div>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function AlertsPanel({ style }: { style?: React.CSSProperties }) {
  const s = useStore();
  const crit = s.alerts.filter((a) => a.level === 'critical').length;
  return (
    <Panel code="ALR-04 · Anomalías térmicas" title="Centro de alertas" style={style} bodyClass="scroll"
      meta={<span className="linkpill" style={{ padding: '3px 8px', color: crit ? '#FF8FA3' : undefined }}><span className={`dot ${crit ? 'dot--crit dot--live' : ''}`} />{crit} críticas</span>}>
      <AlertList />
    </Panel>
  );
}
