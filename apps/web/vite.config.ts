import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Before react(): it generates src/routeTree.gen.ts from src/routes.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    // The alias shadcn/ui's generated components import through.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  preview: {
    port: 4173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
  build: {
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
