import { useEffect, useRef } from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { store } from '../engine/store';
import { MapRenderer, type Insets } from './renderer';

interface Props {
  insets: Insets;
  compact?: boolean;
  controls?: 'right' | 'left' | 'none';
  controlsOffset?: { top?: number; bottom?: number; side?: number };
}

export function TacticalMap({ insets, compact = false, controls = 'right', controlsOffset }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const r = new MapRenderer(canvas);
    r.insets = insets;
    r.compact = compact;
    rendererRef.current = r;

    // dimensiones de layout (sin transform): el simulador Android escala el dispositivo con CSS
    const ro = new ResizeObserver(() => {
      r.resize(wrap.offsetWidth, wrap.offsetHeight, Math.min(window.devicePixelRatio || 1, 2) * cssScale());
    });
    const cssScale = () => {
      const rect = wrap.getBoundingClientRect();
      return wrap.offsetWidth ? rect.width / wrap.offsetWidth : 1;
    };
    ro.observe(wrap);

    let raf = 0;
    const loop = (now: number) => {
      r.draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // ---- interacción: pan / zoom / pinch / selección / divisor
    const pointers = new Map<number, { x: number; y: number }>();
    let dragSplit = false;
    let moved = 0;
    let pinchDist = 0;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const k = cssScale() || 1;
      return { x: (e.clientX - rect.left) / k, y: (e.clientY - rect.top) / k };
    };
    const onDown = (e: PointerEvent) => {
      const p = local(e);
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, p);
      moved = 0;
      if (store.ui.mode === 'split' && !store.ui.replay.active && Math.abs(p.x - r.splitX) < 22) dragSplit = true;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (e.pointerType === 'mouse') r.cursor = p;
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        canvas.style.cursor = store.ui.mode === 'split' && Math.abs(p.x - r.splitX) < 22 ? 'ew-resize' : 'crosshair';
        return;
      }
      moved += Math.hypot(p.x - prev.x, p.y - prev.y);
      pointers.set(e.pointerId, p);
      if (dragSplit) { r.splitX = p.x; return; }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) r.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
        return;
      }
      r.pan(p.x - prev.x, p.y - prev.y);
    };
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (dragSplit) { dragSplit = false; return; }
      if (moved < 6) {
        let best: string | null = null, bd = e.pointerType === 'touch' ? 28 : 18;
        for (const h of r.hits) {
          const d = Math.hypot(h.x - p.x, h.y - p.y);
          if (d < bd) { bd = d; best = h.id; }
        }
        if (best) store.setUI({ selected: best });
      }
    };
    const onLeave = () => { r.cursor = null; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      r.zoomAt(p.x, p.y, Math.pow(1.0016, -e.deltaY));
    };
    const onDbl = () => r.fit(true);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDbl);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDbl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    const changed = JSON.stringify(r.insets) !== JSON.stringify(insets);
    r.insets = insets;
    r.compact = compact;
    if (changed && r.w) { r.fit(true); r.splitX = r.freeCenterX(); }
  }, [insets, compact]);

  const ctrlStyle: React.CSSProperties = {
    top: controlsOffset?.top ?? insets.top + 64,
    ...(controls === 'left' ? { left: controlsOffset?.side ?? insets.left + 14 } : { right: controlsOffset?.side ?? insets.right + 14 }),
  };

  return (
    <div ref={wrapRef} className="tmap">
      <canvas ref={canvasRef} className="tmap__canvas" />
      {controls !== 'none' && (
        <div className="tmap__ctrls" style={ctrlStyle}>
          <button className="icon-btn" aria-label="Acercar" onClick={() => { const r = rendererRef.current!; r.zoomAt(r.w / 2, r.h / 2, 1.35); }}><Plus size={15} /></button>
          <button className="icon-btn" aria-label="Alejar" onClick={() => { const r = rendererRef.current!; r.zoomAt(r.w / 2, r.h / 2, 1 / 1.35); }}><Minus size={15} /></button>
          <button className="icon-btn" aria-label="Encuadrar área" onClick={() => rendererRef.current!.fit(true)}><Crosshair size={15} /></button>
        </div>
      )}
    </div>
  );
}
