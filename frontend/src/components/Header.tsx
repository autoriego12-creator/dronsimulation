import { useEffect, useState } from 'react';
import { Flame, MonitorSmartphone, Monitor, ShieldHalf, Smartphone, Sprout } from 'lucide-react';
import { link } from '../engine/link';
import { store, useStore } from '../engine/store';
import type { ScenarioId, ViewMode } from '../engine/types';
import { MODE_OPTIONS } from './ComparatorPanel';
import { BrandMark, Seg, fmtClock } from './ui';

export const SCENARIO_OPTIONS: { id: ScenarioId; label: string; short: string; icon: React.ReactNode }[] = [
  { id: 'security', label: 'Vigilancia', short: 'Vigilancia', icon: <ShieldHalf size={13} /> },
  { id: 'agriculture', label: 'Agrícola', short: 'Agro', icon: <Sprout size={13} /> },
  { id: 'emergency', label: 'Emergencias', short: 'Emerg.', icon: <Flame size={13} /> },
];

const VIEW_OPTIONS: { id: ViewMode; label: string; icon: React.ReactNode; title: string }[] = [
  { id: 'web', label: 'Panel Web', icon: <Monitor size={13} />, title: 'Centro de mando de escritorio' },
  { id: 'android', label: 'Simulador Android', icon: <Smartphone size={13} />, title: 'App de operador en campo (APK)' },
  { id: 'auto', label: 'Auto', icon: <MonitorSmartphone size={13} />, title: 'Responsive automático según el viewport' },
];

export function useUtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function LinkPill({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const src = s.link.source;
  const label = src === 'backend' ? 'BACKEND PY' : src === 'local' ? 'MOTOR LOCAL' : 'CONECTANDO';
  return (
    <span className="linkpill" title={src === 'backend' ? `FastAPI + WebSocket · ${s.link.url}` : 'Motor TypeScript embebido (sin backend)'}>
      <span className={`dot dot--live ${src === 'local' ? 'dot--info' : src === 'connecting' ? 'dot--warn' : ''}`} />
      <strong>{label}</strong>
      {!compact && <span>· {s.frame ? `${s.link.hz.toFixed(1)} Hz · KDE ${s.frame.metrics.kde_ms.toFixed(1)} ms` : '—'}</span>}
    </span>
  );
}

export function Header() {
  const s = useStore();
  const now = useUtcClock();
  return (
    <header className="header">
      <div className="brand">
        <BrandMark />
        <div>
          <div className="brand__name">HELIOS<b>·KDE</b> <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em' }}>ID 4300</span></div>
          <div className="brand__sub">Geolocalización y monitoreo de drones por mapa de calor · rastreo térmico virtual</div>
        </div>
      </div>
      <div className="header__center">
        <Seg label="Escenario" value={s.ui.scenario} options={SCENARIO_OPTIONS} onChange={(v) => link.setScenario(v)} />
        <Seg label="Modo de rastreo" variant="violet" value={s.ui.mode} options={MODE_OPTIONS} onChange={(v) => store.setUI({ mode: v })} />
      </div>
      <div className="header__right">
        <Seg label="Vista" size="sm" value={s.ui.view} options={VIEW_OPTIONS} onChange={(v) => store.setUI({ view: v })} />
        <LinkPill />
        <div className="clock">
          <b>{now.toISOString().slice(11, 19)}</b> UTC<br />
          <span>MISIÓN T+{fmtClock(s.frame?.t ?? 0)}</span>
        </div>
      </div>
    </header>
  );
}
