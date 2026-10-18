import type { CSSProperties, ReactNode } from 'react';
import { irColor } from '../engine/colormap';

export function Panel({ code, title, meta, children, className = '', style, bodyClass = 'panel__body' }: {
  code?: string; title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties; bodyClass?: string;
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      <header className="panel__head">
        <div>
          {code && <div className="panel__code">{code}</div>}
          <div className="panel__title">{title}</div>
        </div>
        {meta && <div className="panel__meta">{meta}</div>}
      </header>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Seg<T extends string>({ value, options, onChange, variant, size, label }: {
  value: T; options: { id: T; label: ReactNode; icon?: ReactNode; title?: string }[]; onChange: (v: T) => void;
  variant?: 'violet'; size?: 'sm'; label: string;
}) {
  return (
    <div className={`seg ${variant ? 'seg--' + variant : ''} ${size ? 'seg--' + size : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} className="seg__btn" aria-pressed={value === o.id} title={o.title} onClick={() => onChange(o.id)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/** Sparkline de una sola serie (el título nombra la serie; sin leyenda). */
export function Sparkline({ data, color, min, max, height = 30, fill = true, threshold }: {
  data: number[]; color: string; min?: number; max?: number; height?: number; fill?: boolean; threshold?: number;
}) {
  const w = 160;
  if (data.length < 2) return <svg viewBox={`0 0 ${w} ${height}`} />;
  const lo = min ?? Math.min(...data), hi = max ?? Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - 2 - ((v - lo) / span) * (height - 4)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const id = `sg${color.replace(/[^a-z0-9]/gi, '')}`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {threshold !== undefined && (
        <line x1="0" x2={w} y1={height - 2 - ((threshold - lo) / span) * (height - 4)} y2={height - 2 - ((threshold - lo) / span) * (height - 4)}
          stroke="rgba(255,42,84,0.5)" strokeDasharray="2 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      )}
      {fill && <path d={`${d}L${w},${height}L0,${height}Z`} fill={`url(#${id})`} />}
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

export function IrBar({ ir }: { ir: number }) {
  return (
    <div className="irbar" aria-label={`Firma IR ${(ir * 100).toFixed(0)}%`}>
      <i style={{ width: `${Math.max(4, ir * 100)}%`, background: `linear-gradient(90deg, ${irColor(0)}, ${irColor(ir)})`, boxShadow: `0 0 8px ${irColor(ir, 0.8)}` }} />
    </div>
  );
}

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg className="brand__mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <defs>
        <radialGradient id="bm" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#FF2A54" /><stop offset="0.4" stopColor="#FACC15" stopOpacity="0.8" />
          <stop offset="0.75" stopColor="#00F0FF" stopOpacity="0.35" /><stop offset="1" stopColor="#00F0FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill="url(#bm)" opacity="0.55" />
      <circle cx="20" cy="20" r="17" fill="none" stroke="#00F0FF" strokeOpacity="0.5" />
      <circle cx="20" cy="20" r="10" fill="none" stroke="#00F0FF" strokeOpacity="0.3" strokeDasharray="2 3">
        <animateTransform attributeName="transform" type="rotate" from="0 20 20" to="360 20 20" dur="12s" repeatCount="indefinite" />
      </circle>
      <path d="M20 9 L26 27 L20 23.5 L14 27 Z" fill="#E6FBFF" stroke="#00F0FF" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function fmtClock(t: number) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
