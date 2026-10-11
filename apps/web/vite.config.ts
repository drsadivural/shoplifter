/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const API_TARGET = process.env.RG_API_TARGET ?? 'http://127.0.0.1:8710';

const proxy = {
  '/v1': { target: API_TARGET, changeOrigin: false, ws: true },
  '/healthz': { target: API_TARGET, changeOrigin: false },
};

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Self-hosted Noto Sans JP lives in the repository-level assets folder.
      '@fonts': fileURLToPath(new URL('../../assets/fonts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy,
    fs: { allow: [repoRoot] },
  },
  preview: { port: 4173, proxy },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
