import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer is loaded by Electron from renderer/dist/index.html over file://, so every
// asset reference must be relative (base './'). Electron 33 = Chromium 130: no legacy bundle.
export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: 'public',
  plugins: [react()],
  resolve: {
    alias: [
      // the hub imports both 'react-spring' and '@react-spring/web' — ship one copy
      { find: /^react-spring$/, replacement: '@react-spring/web' },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
