import { useEffect } from 'react';
import { Pause, Play, Radio, Rewind } from 'lucide-react';
import { store, useStore } from '../engine/store';
import { Seg, fmtClock } from './ui';

const LEVEL_COLOR = { critical: '#FF2A54', warning: '#FFB020', info: '#00F0FF' } as const;

/** Bucle de reproducción: avanza instantáneas (2 Hz grabadas) a la velocidad elegida. */
export function useReplayLoop() {
  useEffect(() => {
    let t: number;
    const tick = () => {
      const r = store.ui.replay;
      if (r.active && r.playing) {
        const next = r.index + 1;
        if (next >= store.history.length) store.setReplay({ active: false, playing: false });
        else store.setReplay({ index: next });
      }
      t = window.setTimeout(tick, 500 / Math.max(1, store.ui.replay.speed));
    };
    tick();
    return () => clearTimeout(t);
  }, []);
}

export function HistoryBody({ compact = false }: { compact?: boolean }) {
  const s = useStore();
  const H = s.history;
  const r = s.ui.replay;
  const idx = r.active ? Math.min(r.index, H.length - 1) : H.length - 1;
  const t0 = H[0]?.t ?? 0, t1 = H[H.length - 1]?.t ?? 0;
  const p = H.length > 1 ? (idx / (H.length - 1)) * 100 : 100;
  const marks = s.alerts.filter((a) => a.t >= t0 && a.t <= t1 && a.level !== 'info').slice(0, 80);
  const sel = s.ui.selected;
  const selTrail = sel && H.length ? H.slice(Math.max(0, idx - 120), idx + 1).map((h) => h.drones.find((d) => d.id === sel)).filter(Boolean) : [];
  const dist = selTrail.reduce((acc, d, i, arr) => (i ? acc + Math.hypot(d!.x - arr[i - 1]!.x, d!.y - arr[i - 1]!.y) : 0), 0);
  const maxIr = selTrail.reduce((a, d) => Math.max(a, d!.ir), 0);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="replay">
        <button className="icon-btn" aria-label="Reiniciar" onClick={() => store.setReplay({ active: true, index: 0, playing: true })}><Rewind size={14} /></button>
        <button className="icon-btn" aria-label={r.active && r.playing ? 'Pausar' : 'Reproducir'} style={{ color: 'var(--v-300)', borderColor: 'rgba(168,85,247,0.4)' }}
          onClick={() => {
            if (!r.active) store.setReplay({ active: true, index: Math.max(0, H.length - 120), playing: true });
            else store.setReplay({ playing: !r.playing });
          }}>
          {r.active && r.playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input className="range" type="range" min={0} max={Math.max(0, H.length - 1)} value={idx} aria-label="Línea de tiempo"
            style={{ ['--p' as string]: `${p}%`, width: '100%' }}
            onChange={(e) => store.setReplay({ active: true, index: +e.target.value, playing: false })} />
          <div className="timeline-marks">
            {marks.map((a) => (
              <i key={a.id} title={a.msg} style={{ left: `${((a.t - t0) / Math.max(1, t1 - t0)) * 100}%`, background: LEVEL_COLOR[a.level] }} />
            ))}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 11, minWidth: 92, textAlign: 'right' }}>
          T+{fmtClock(H[idx]?.t ?? 0)}<br /><span style={{ color: 'var(--ink-3)', fontSize: 9.5 }}>de {fmtClock(t1)}</span>
        </span>
        {!compact && <Seg label="Velocidad" size="sm" variant="violet" value={String(r.speed) as '1' | '2' | '4'}
          options={[{ id: '1', label: '1×' }, { id: '2', label: '2×' }, { id: '4', label: '4×' }]}
          onChange={(v) => store.setReplay({ speed: +v })} />}
        <button className="btn" disabled={!r.active} onClick={() => store.setReplay({ active: false, playing: false })}><Radio size={13} />En vivo</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8 }}>
        <div className="stat"><div className="stat__v num">{H.length}</div><div className="stat__l">Instantáneas (2 Hz)</div></div>
        <div className="stat"><div className="stat__v num">{fmtClock(t1 - t0)}</div><div className="stat__l">Ventana grabada</div></div>
        <div className="stat"><div className="stat__v num">{(dist / 1000).toFixed(2)}<small style={{ fontSize: 10, color: 'var(--ink-3)' }}> km</small></div><div className="stat__l">Recorrido {sel ?? ''} (60 s)</div></div>
        <div className="stat"><div className="stat__v num">{(maxIr * 100).toFixed(0)}%</div><div className="stat__l">IR máx. tramo</div></div>
      </div>
    </div>
  );
}
