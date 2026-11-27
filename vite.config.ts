import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  envDir: '..',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:2567',
        ws: true,
      },
    },
  },
});
