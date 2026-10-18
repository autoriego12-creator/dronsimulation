import { Battery, Gauge, Mountain, Thermometer } from 'lucide-react';
import { irColor } from '../engine/colormap';
import { store, useStore } from '../engine/store';
import { IrBar, Panel, Sparkline } from './ui';

export function FleetSummary() {
  const s = useStore();
  const ds = s.frame?.drones ?? [];
  const avg = ds.length ? ds.reduce((a, d) => a + d.thermal, 0) / ds.length : 0;
  const maxIr = ds.reduce((a, d) => Math.max(a, d.ir), 0);
  return (
    <div className="fleet-sum">
      <div className="stat"><div className="stat__v num">{ds.length}</div><div className="stat__l">Activos</div></div>
      <div className="stat"><div className="stat__v num">{avg.toFixed(1)}<small style={{ fontSize: 10, color: 'var(--ink-3)' }}>°C</small></div><div className="stat__l">Temp. media</div></div>
      <div className="stat"><div className="stat__v num" style={{ color: irColor(maxIr) }}>{(maxIr * 100).toFixed(0)}%</div><div className="stat__l">IR máx.</div></div>
    </div>
  );
}

export function FleetList({ onPick }: { onPick?: (id: string) => void }) {
  const s = useStore();
  const ds = s.frame?.drones ?? [];
  return (
    <div className="fleet-list" role="listbox" aria-label="Flota de drones">
      {ds.map((d) => (
        <button key={d.id} className="frow" role="option" aria-selected={s.ui.selected === d.id}
          onClick={() => { store.setUI({ selected: d.id }); store.focusOn(d.x, d.y); onPick?.(d.id); }}>
          <span className={`dot ${d.status === 'hot' ? 'dot--crit dot--live' : d.status === 'lowbat' ? 'dot--warn' : ''}`} />
          <span>
            <div className="frow__id">{d.id}</div>
            <div className="frow__cs">{d.callsign} · {d.task === 'sweep' ? 'BARRIDO' : d.task === 'converge' ? 'CONVERGENCIA' : 'PATRULLA'}</div>
          </span>
          <span>
            <IrBar ir={d.ir} />
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--ink-3)', marginTop: 4 }}>{d.alt.toFixed(0)} m · {d.speed.toFixed(1)} m/s</div>
          </span>
          <span className="frow__t" style={{ color: irColor(d.ir) }}>{d.thermal.toFixed(1)}°</span>
        </button>
      ))}
    </div>
  );
}

export function FleetPanel({ style }: { style?: React.CSSProperties }) {
  const s = useStore();
  return (
    <Panel code="FLT-01 · Flota" title="Flota en vuelo" style={style} bodyClass="scroll" className="fleet-panel"
      meta={<span className="linkpill" style={{ padding: '3px 8px' }}><span className="dot dot--live" />{s.config?.scenarios?.[s.ui.scenario] ?? ''}</span>}>
      <FleetSummary />
      <FleetList />
    </Panel>
  );
}

export function TelemetryBody() {
  const s = useStore();
  const d = s.frame?.drones.find((q) => q.id === s.ui.selected);
  const ser = d ? s.series.get(d.id) : undefined;
  const rf = s.frame?.rf.find((q) => q.id === s.ui.selected);
  if (!d) return <div className="eyebrow">Sin dron seleccionado</div>;
  const items: [string, React.ReactNode][] = [
    ['LATITUD', <>{d.lat.toFixed(6)}<small>°N</small></>],
    ['LONGITUD', <>{Math.abs(d.lon).toFixed(6)}<small>°W</small></>],
    ['ALTITUD', <>{d.alt.toFixed(1)}<small>m AGL</small></>],
    ['VELOCIDAD', <>{d.speed.toFixed(1)}<small>m/s</small></>],
    ['RUMBO', <>{d.heading.toFixed(0).padStart(3, '0')}<small>°</small></>],
    ['BATERÍA', <span style={{ color: d.battery < 20 ? 'var(--amber)' : undefined }}>{d.battery.toFixed(0)}<small>%</small></span>],
    ['FIRMA IR', <span style={{ color: irColor(d.ir) }}>{d.thermal.toFixed(1)}<small>°C</small></span>],
    ['ERR. GNSS', <>{Math.hypot(d.x - d.tx, d.y - d.ty).toFixed(1)}<small>m</small></>],
  ];
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <HeadingDial deg={d.heading} ir={d.ir} />
        <div>
          <div className="mono" style={{ fontSize: 17, fontWeight: 700 }}>{d.id}</div>
          <div className="eyebrow" style={{ color: 'var(--cyan-dim)' }}>{d.callsign} · {d.status === 'hot' ? 'FIRMA CRÍTICA' : d.status === 'lowbat' ? 'BATERÍA BAJA' : 'NOMINAL'}</div>
          {rf && <div className="mono" style={{ fontSize: 9.5, color: rf.lost ? 'var(--amber)' : 'var(--ink-3)', marginTop: 3 }}>RF: {rf.lost ? 'SIN ENLACE' : `±${rf.sigma.toFixed(0)} m · Δ${(rf.age_ms / 1000).toFixed(1)} s`}</div>}
        </div>
      </div>
      <div className="tlm-grid">
        {items.map(([l, v]) => (
          <div className="tlm" key={l}><span className="tlm__l">{l}</span><span className="tlm__v">{v}</span></div>
        ))}
      </div>
      <div className="spark-wrap">
        <div className="spark"><span className="eyebrow"><Thermometer size={10} /> Térmica</span><Sparkline data={ser?.thermal ?? []} color={irColor(d.ir)} threshold={88} /><span className="mono" style={{ fontSize: 10.5, textAlign: 'right' }}>{d.thermal.toFixed(1)}°</span></div>
        <div className="spark"><span className="eyebrow"><Mountain size={10} /> Altitud</span><Sparkline data={ser?.alt ?? []} color="#00F0FF" /><span className="mono" style={{ fontSize: 10.5, textAlign: 'right' }}>{d.alt.toFixed(0)} m</span></div>
        <div className="spark"><span className="eyebrow"><Gauge size={10} /> Veloc.</span><Sparkline data={ser?.speed ?? []} color="#A855F7" min={0} /><span className="mono" style={{ fontSize: 10.5, textAlign: 'right' }}>{d.speed.toFixed(1)}</span></div>
      </div>
    </>
  );
}

function HeadingDial({ deg, ir }: { deg: number; ir: number }) {
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" aria-label={`Rumbo ${deg.toFixed(0)}°`}>
      <circle cx="27" cy="27" r="24" fill="rgba(0,240,255,0.04)" stroke="rgba(0,240,255,0.3)" />
      {Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2, r1 = i % 6 === 0 ? 18 : 21;
        return <line key={i} x1={27 + Math.sin(a) * r1} y1={27 - Math.cos(a) * r1} x2={27 + Math.sin(a) * 24} y2={27 - Math.cos(a) * 24} stroke="rgba(143,163,191,0.5)" strokeWidth={i % 6 === 0 ? 1.4 : 0.7} />;
      })}
      <text x="27" y="10.5" textAnchor="middle" fontSize="6" fill="#00F0FF" fontFamily="var(--font-mono)" fontWeight="700">N</text>
      <g transform={`rotate(${deg} 27 27)`} style={{ transition: 'transform 0.1s linear' }}>
        <path d="M27 11 L31 31 L27 28 L23 31 Z" fill="#E6FBFF" stroke={irColor(ir)} strokeWidth="1.2" />
      </g>
    </svg>
  );
}

export function TelemetryPanel({ style }: { style?: React.CSSProperties }) {
  const s = useStore();
  const d = s.frame?.drones.find((q) => q.id === s.ui.selected);
  return (
    <Panel code="TLM-02 · GNSS + IR · 10 Hz" title="Telemetría en vivo" style={style} bodyClass="panel__body scroll"
      meta={d && <span className="mono" style={{ fontSize: 10, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 5 }}><Battery size={12} />{d.battery.toFixed(0)}%</span>}>
      <TelemetryBody />
    </Panel>
  );
}
