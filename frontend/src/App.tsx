import { useEffect, useState } from 'react';
import { useReplayLoop } from './components/History';
import { ReportModal } from './components/Validation';
import { link } from './engine/link';
import { store, useStore } from './engine/store';
import { AndroidStage } from './layouts/AndroidStage';
import { DesktopLayout } from './layouts/DesktopLayout';
import { MobileLayout, haptic } from './layouts/MobileLayout';

const MOBILE_BREAKPOINT = 900;

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}

export default function App() {
  const s = useStore();
  const narrow = useIsNarrow();
  useReplayLoop();

  useEffect(() => {
    link.start();
    store.onCritical = () => haptic(60);
  }, []);

  // En pantallas estrechas el simulador de dispositivo no cabe: se muestra la app nativa directamente.
  const layout = s.ui.view === 'android' ? (narrow ? 'mobile' : 'android') : s.ui.view === 'web' ? 'web' : narrow ? 'mobile' : 'web';

  return (
    <>
      {layout === 'web' && <DesktopLayout />}
      {layout === 'android' && <AndroidStage />}
      {layout === 'mobile' && <MobileLayout />}
      <ReportModal />
    </>
  );
}
