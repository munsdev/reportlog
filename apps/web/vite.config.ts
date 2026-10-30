import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const API = 'http://127.0.0.1:3000';

/**
 * As Caddy does on a server (deploy/caddy/Caddyfile): the API, and the two
 * files search engines ask for at the root, which the API builds.
 */
const API_PROXY = {
  '/api': API,
  '/robots.txt': { target: API, rewrite: () => '/api/site/robots.txt' },
  '/sitemap.xml': { target: API, rewrite: () => '/api/site/sitemap.xml' },
};

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
    proxy: API_PROXY,
  },
  preview: {
    port: 4173,
    proxy: API_PROXY,
  },
  build: {
    // Off in production: the maps published the source to anybody who asked
    // (a scripted bot review, 23 October).
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
