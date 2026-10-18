import { useMemo } from 'react';
import { ChevronDown, ChevronUp, FlaskConical, History } from 'lucide-react';
import { AlertsPanel } from '../components/AlertsPanel';
import { ComparatorPanel } from '../components/ComparatorPanel';
import { FleetPanel, TelemetryPanel } from '../components/FleetPanels';
import { Header } from '../components/Header';
import { HistoryBody } from '../components/History';
import { Panel, Seg } from '../components/ui';
import { ValidationBody } from '../components/Validation';
import { store, useStore } from '../engine/store';
import { TacticalMap } from '../map/TacticalMap';

export function DesktopLayout() {
  const s = useStore();
  const open = s.ui.dockOpen;
  const dockH = open ? (s.ui.dockTab === 'validation' ? 330 : 150) : 52;
  const insets = useMemo(() => ({ top: 64, left: 348, right: 376, bottom: dockH + 24 }), [dockH]);

  return (
    <div className="desk">
      <TacticalMap insets={insets} />
      <div className="hud-overlay" />
      <Header />

      <aside className="desk__left">
        <FleetPanel style={{ flex: '1 1 46%' }} />
        <TelemetryPanel style={{ flex: '1 1 54%' }} />
      </aside>

      <aside className="desk__right">
        <ComparatorPanel style={{ flex: '0 1 auto', maxHeight: '56%' }} />
        <AlertsPanel style={{ flex: '1 1 0' }} />
      </aside>

      <div className="desk__dock">
        <Panel
          code={s.ui.dockTab === 'validation' ? 'VAL-05 · Resultados esperados' : 'HST-06 · Trayectorias'}
          title={s.ui.dockTab === 'validation' ? 'Panel de validación científica' : 'Historial reproducible de rutas'}
          bodyClass="panel__body scroll"
          style={{ height: dockH, transition: 'height 0.45s var(--ease-out)', overflow: 'hidden' }}
          meta={
            <div className="dock-tabs">
              <Seg label="Panel inferior" size="sm" variant="violet" value={s.ui.dockTab}
                options={[{ id: 'validation', label: 'Validación', icon: <FlaskConical size={12} /> }, { id: 'routes', label: 'Historial', icon: <History size={12} /> }]}
                onChange={(v) => store.setUI({ dockTab: v, dockOpen: true })} />
              <button className="icon-btn" aria-label={open ? 'Contraer panel' : 'Expandir panel'} onClick={() => store.setUI({ dockOpen: !open })}>
                {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
              </button>
            </div>
          }>
          {open && (s.ui.dockTab === 'validation' ? <ValidationBody /> : <HistoryBody />)}
        </Panel>
      </div>
    </div>
  );
}
