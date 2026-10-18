import { useEffect, useRef, useState } from 'react';
import { Header } from '../components/Header';
import { MobileLayout } from './MobileLayout';

/** Proyección de la app de operador Android dentro de un dispositivo simulado. */
export function AndroidStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, (e.contentRect.height - 24) / 880)));
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      <Header />
      <div className="android-stage" ref={stageRef}>
        <div style={{ width: 400 * scale, height: 860 * scale, flex: 'none', position: 'relative' }}>
          <div className="phone" style={{ transform: `scale(${scale})`, position: 'absolute', left: 0, top: 0, transformOrigin: 'top left' }}>
            <span className="phone__btn" style={{ top: 170, height: 64 }} />
            <span className="phone__btn" style={{ top: 260, height: 110 }} />
            <div className="phone__screen">
              <div className="phone__cam" />
              <MobileLayout simulated />
            </div>
          </div>
        </div>
        <aside className="stage-info panel" style={{ padding: 22 }}>
          <div className="panel__code">AND-07 · Operador en campo</div>
          <h2>App táctil <span>Android</span> para operadores</h2>
          <p>
            Misma telemetría a 100 ms que el centro de mando, con bottom sheets deslizables, dock translúcido,
            radar compacto y alertas hápticas. Sin enlace al backend, el APK conmuta al motor KDE embebido.
          </p>
          <dl className="spec">
            <dt>Empaquetado</dt><dd>Capacitor 6 · PWA instalable</dd>
            <dt>App ID</dt><dd>co.id4300.thermalc2</dd>
            <dt>Enlace</dt><dd>WebSocket /ws/telemetry</dd>
            <dt>Fallback</dt><dd>Motor local TypeScript</dd>
            <dt>Gestos</dt><dd>Pinch-zoom · pan · tap-select</dd>
          </dl>
          <code className="cmd">{'npm run cap:android\nnpm run cap:open   # Android Studio → Build APK'}</code>
        </aside>
      </div>
    </>
  );
}
