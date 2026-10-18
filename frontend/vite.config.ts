import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/ws': { target: API.replace('http', 'ws'), ws: true },
    },
  },
  build: { target: 'es2021', chunkSizeWarningLimit: 900 },
});
