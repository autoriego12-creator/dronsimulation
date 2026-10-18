import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.id4300.thermalc2',
  appName: 'ID 4300 Thermal C2',
  webDir: 'dist',
  backgroundColor: '#04070F',
  android: { allowMixedContent: true, backgroundColor: '#04070F' },
  server: { androidScheme: 'https', cleartext: true },
  plugins: {
    StatusBar: { style: 'DARK', backgroundColor: '#04070F', overlaysWebView: false },
  },
};

export default config;
